begin;
create table public.worker_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into public.worker_settings values(true, false);
create table public.flight_monitoring (
  id uuid primary key default gen_random_uuid(),
  number text not null check(number ~ '^[A-Z0-9]{2,3}[0-9]{1,4}[A-Z]?$'),
  departure_date date not null,
  origin text not null check(origin ~ '^[A-Z]{3}$'),
  destination text not null check(destination ~ '^[A-Z]{3}$' and destination <> origin),
  departure_at timestamptz not null,
  stop_at timestamptz not null,
  active boolean not null default true,
  next_check_at timestamptz not null default now(),
  attempts integer not null default 0 check(attempts between 0 and 12),
  last_outcome text,
  check(stop_at > departure_at and stop_at <= departure_at + interval '6 hours'),
  unique(number, departure_date, origin, destination)
);
-- One operator-managed pilot flight at a time. No public enrollment yet.
create unique index one_active_pilot on public.flight_monitoring((true)) where active;
create table public.worker_attempts (
  id uuid primary key default gen_random_uuid(),
  monitoring_id uuid references public.flight_monitoring(id) on delete set null,
  reserved_at timestamptz not null default now(),
  units integer not null default 2 check(units = 2),
  outcome text not null default 'reserved'
);
create index on public.worker_attempts(reserved_at);
alter table public.worker_settings enable row level security;
alter table public.flight_monitoring enable row level security;
alter table public.worker_attempts enable row level security;
revoke all on public.worker_settings, public.flight_monitoring, public.worker_attempts from anon, authenticated;
grant select, insert, update, delete on public.worker_settings, public.flight_monitoring, public.worker_attempts to service_role;

-- Delete provider-derived data when live monitoring ends. Budget history has no
-- provider contents and is retained so deleting a flight never resets allowance.
create function public.clear_stopped_flight() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if old.active and not new.active then
    delete from public.flight_tracks where id = concat_ws('|', 'aerodatabox', old.number, old.origin, old.destination, old.departure_date::text);
    delete from public.flight_monitoring where id = old.id;
  end if;
  return null;
end;
$$;
create trigger clear_stopped_flight after update of active on public.flight_monitoring
for each row execute function public.clear_stopped_flight();
revoke all on function public.clear_stopped_flight() from public, anon, authenticated;

-- An in-flight response must not recreate data after a stop/unsubscribe. Lock
-- the monitoring row for the save transaction, just as stop processing does.
create function public.require_active_monitor() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.source = 'aerodatabox' then
    perform 1 from public.flight_monitoring
      where active and stop_at > now()
        and concat_ws('|','aerodatabox',number,origin,destination,departure_date::text) = new.id
      for update;
    if not found then raise exception 'Live persistence requires an active monitor'; end if;
  end if;
  return new;
end;
$$;
create trigger require_active_monitor before insert or update on public.flight_tracks
for each row execute function public.require_active_monitor();
revoke all on function public.require_active_monitor() from public, anon, authenticated;

create function public.claim_flight_check() returns jsonb
language plpgsql security invoker set search_path = public as $$
declare setting public.worker_settings; target public.flight_monitoring; attempt_id uuid;
begin
  -- Serializes all claims across invocations, including overlapping Cron requests.
  select * into setting from public.worker_settings where singleton = true for update;
  if not found then raise exception 'Worker settings missing'; end if;
  update public.flight_monitoring set active = false where active and (stop_at <= now() or attempts >= 12);
  if not setting.enabled then return jsonb_build_object('result', 'disabled'); end if;
  -- Rolling 35-day window avoids guessing RapidAPI's billing-cycle reset date.
  if (select coalesce(sum(units),0) from public.worker_attempts where reserved_at >= now() - interval '35 days') + 2 > 80 then
    return jsonb_build_object('result', 'budget_exhausted');
  end if;
  if (select count(*) from public.worker_attempts where reserved_at >= now() - interval '24 hours') >= 4 then
    return jsonb_build_object('result', 'daily_limit');
  end if;
  select * into target from public.flight_monitoring
    where active and next_check_at <= now() and departure_at - interval '6 hours' <= now() and stop_at > now()
    order by next_check_at limit 1 for update;
  if not found then return jsonb_build_object('result', 'idle'); end if;
  insert into public.worker_attempts(monitoring_id) values(target.id) returning id into attempt_id;
  update public.flight_monitoring set attempts = attempts + 1, next_check_at = now() + interval '1 hour'
    where id = target.id;
  return jsonb_build_object('result', 'claimed', 'attempt_id', attempt_id, 'flight', to_jsonb(target));
end;
$$;

create function public.finish_flight_check(p_attempt_id uuid, p_outcome text, p_stop boolean default false)
returns void language plpgsql security invoker set search_path = public as $$
declare target_id uuid;
begin
  if p_outcome not in ('saved', 'stale', 'duplicate', 'no_match', 'ambiguous', 'unsupported_route', 'failed') then raise exception 'Invalid outcome'; end if;
  update public.worker_attempts set outcome = p_outcome where id = p_attempt_id and outcome = 'reserved'
    returning monitoring_id into target_id;
  if target_id is null then return; end if;
  update public.flight_monitoring set last_outcome = p_outcome,
    active = not (p_stop or attempts >= 12 or stop_at <= now()) where id = target_id;
end;
$$;
revoke all on function public.claim_flight_check() from public, anon, authenticated;
revoke all on function public.finish_flight_check(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.claim_flight_check() to service_role;
grant execute on function public.finish_flight_check(uuid,text,boolean) to service_role;

-- Extend the existing daily purge without changing the user's Cron job.
create or replace function public.purge_expired_flight_data() returns void
language plpgsql security invoker set search_path = public as $$
begin
  update public.flight_monitoring set active = false where active and (stop_at <= now() or attempts >= 12);
  delete from public.flight_observations where expires_at <= now();
  update public.flight_tracks set comparison_state = null, observed_at = null,
    expires_at = null, version = version + 1 where expires_at <= now();
  delete from public.worker_attempts where reserved_at < now() - interval '90 days';
end;
$$;
commit;
