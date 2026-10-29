begin;

create table public.flight_tracks (
  id text primary key,
  source text not null check (source in ('synthetic', 'aerodatabox')),
  version bigint not null default 0,
  comparison_state jsonb,
  observed_at timestamptz,
  expires_at timestamptz
);
create table public.flight_observations (
  id uuid primary key,
  flight_id text not null references public.flight_tracks(id) on delete cascade,
  observed_at timestamptz not null,
  snapshot jsonb not null,
  expires_at timestamptz not null
);
create table public.flight_changes (
  observation_id uuid not null references public.flight_observations(id) on delete cascade,
  event_index integer not null,
  event jsonb not null,
  primary key (observation_id, event_index)
);
create index on public.flight_observations(flight_id, observed_at);
create index on public.flight_observations(expires_at);
alter table public.flight_tracks enable row level security;
alter table public.flight_observations enable row level security;
alter table public.flight_changes enable row level security;
revoke all on public.flight_tracks, public.flight_observations, public.flight_changes from anon, authenticated;
grant select, insert, update, delete on public.flight_tracks, public.flight_observations, public.flight_changes to service_role;

-- One transaction commits the observation, its events, and the new baseline.
-- The expected version prevents two workers from overwriting each other.
create function public.save_flight_observation(
  p_id uuid, p_flight_id text, p_source text, p_expected_version bigint,
  p_observed_at timestamptz, p_snapshot jsonb, p_state jsonb, p_events jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare track public.flight_tracks; expiry timestamptz;
begin
  if p_source not in ('synthetic', 'aerodatabox') or p_source is null
    or p_observed_at is null or p_observed_at > now() + interval '1 minute'
    or p_observed_at < now() - interval '6 days'
    or jsonb_typeof(p_snapshot) is distinct from 'object'
    or jsonb_typeof(p_state) is distinct from 'object'
    or jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'Invalid observation';
  end if;
  insert into public.flight_tracks(id, source) values(p_flight_id, p_source)
    on conflict (id) do nothing;
  select * into track from public.flight_tracks where id = p_flight_id for update;
  if track.source <> p_source then raise exception 'Source mismatch'; end if;
  if exists(select 1 from public.flight_observations where id = p_id and flight_id = p_flight_id) then
    return jsonb_build_object('result', 'duplicate');
  end if;
  if track.version <> p_expected_version then return jsonb_build_object('result', 'conflict'); end if;
  if track.observed_at is not null and p_observed_at <= track.observed_at then
    return jsonb_build_object('result', 'stale');
  end if;
  expiry := p_observed_at + interval '6 days';
  insert into public.flight_observations values(p_id, p_flight_id, p_observed_at, p_snapshot, expiry);
  insert into public.flight_changes(observation_id, event_index, event)
    select p_id, (ordinality - 1)::integer, value
    from jsonb_array_elements(p_events) with ordinality;
  update public.flight_tracks set version = version + 1, comparison_state = p_state,
    observed_at = p_observed_at, expires_at = expiry where id = p_flight_id;
  return jsonb_build_object('result', 'saved', 'events', jsonb_array_length(p_events));
end;
$$;
revoke all on function public.save_flight_observation(uuid,text,text,bigint,timestamptz,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.save_flight_observation(uuid,text,text,bigint,timestamptz,jsonb,jsonb,jsonb) to service_role;

-- Run daily via Supabase Cron, including when the app is offline.
create function public.purge_expired_flight_data() returns void
language plpgsql security invoker set search_path = public as $$
begin
  delete from public.flight_observations where expires_at <= now();
  update public.flight_tracks set comparison_state = null, observed_at = null,
    expires_at = null, version = version + 1 where expires_at <= now();
end;
$$;
revoke all on function public.purge_expired_flight_data() from public, anon, authenticated;
grant execute on function public.purge_expired_flight_data() to service_role;
commit;
