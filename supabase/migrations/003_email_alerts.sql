begin;
create table public.email_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into public.email_settings values(true,false);
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid unique,
  payload jsonb,
  recipient text,
  status text not null default 'pending' check(status in ('pending','sending','accepted','failed','expired','cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '6 hours',
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0 check(attempts between 0 and 3),
  claim_token uuid,
  lease_until timestamptz,
  provider_id text,
  last_error text
);
create table public.email_attempts (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid references public.email_outbox(id) on delete set null,
  reserved_at timestamptz not null default now()
);
create index on public.email_attempts(reserved_at);
alter table public.email_settings enable row level security;
alter table public.email_outbox enable row level security;
alter table public.email_attempts enable row level security;
revoke all on public.email_settings,public.email_outbox,public.email_attempts from anon,authenticated;
grant select,insert,update,delete on public.email_settings,public.email_outbox,public.email_attempts to service_role;

-- Outbox creation is in the same transaction as saving the flight change.
-- No backfill: old changes and synthetic demos never silently become emails.
create function public.queue_flight_email() returns trigger
language plpgsql security invoker set search_path=public as $$
declare observation record; body jsonb;
begin
  perform 1 from public.email_settings where singleton and enabled for share;
  if not found then return new; end if;
  if not coalesce(new.event->>'type' in ('cancellation','gate_changed') or
    (case when new.event->>'type'='time_changed' and jsonb_typeof(new.event->'minutesChanged')='number'
      then abs((new.event->>'minutesChanged')::numeric)>=15 else false end),false) then return new; end if;
  select o.*,t.source into observation from public.flight_observations o
    join public.flight_tracks t on t.id=o.flight_id where o.id=new.observation_id;
  if observation.source is distinct from 'aerodatabox' then return new; end if;
  body := jsonb_build_object('number',observation.snapshot->>'number',
    'origin',observation.snapshot#>>'{departure,airport}',
    'destination',observation.snapshot#>>'{arrival,airport}',
    'observedAt',observation.observed_at,'test',false,'events',jsonb_build_array(new.event));
  insert into public.email_outbox(observation_id,payload) values(new.observation_id,body)
    on conflict(observation_id) do update
      set payload=jsonb_set(email_outbox.payload,'{events}',(email_outbox.payload->'events') || (excluded.payload->'events'));
  return new;
end;
$$;
create trigger queue_flight_email after insert on public.flight_changes
for each row execute function public.queue_flight_email();

create function public.purge_email_data() returns void
language plpgsql security invoker set search_path=public as $$
begin
  update public.email_outbox set payload=null,recipient=null,status='expired',claim_token=null
    where expires_at<=now() and status in ('pending','sending');
  delete from public.email_attempts where reserved_at < now()-interval '90 days';
  delete from public.email_outbox where created_at < now()-interval '90 days';
end;
$$;

create function public.claim_flight_email(p_recipient text) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare setting public.email_settings; item public.email_outbox; token uuid;
begin
  select * into setting from public.email_settings where singleton for update;
  if not found then raise exception 'Email settings missing'; end if;
  perform public.purge_email_data();
  if not setting.enabled then return jsonb_build_object('result','disabled'); end if;
  if p_recipient is null or p_recipient !~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+\.[^[:space:]<>@,;]+$' then raise exception 'Invalid pilot email'; end if;
  if (select count(*) from public.email_attempts where reserved_at>=now()-interval '35 days')>=20 then return jsonb_build_object('result','email_budget_exhausted'); end if;
  if (select count(*) from public.email_attempts where reserved_at>=now()-interval '24 hours')>=2 then return jsonb_build_object('result','email_daily_limit'); end if;
  -- Unknown send outcomes are retried with the SAME provider idempotency key,
  -- within six hours (well inside Resend's 24-hour deduplication window).
  update public.email_outbox set status='failed',payload=null,recipient=null,claim_token=null
    where status='sending' and lease_until<=now() and attempts>=3;
  select * into item from public.email_outbox
    where expires_at>now() and attempts<3 and next_attempt_at<=now()
      and (status='pending' or (status='sending' and lease_until<=now()))
    order by created_at,id limit 1 for update;
  if not found then return jsonb_build_object('result','idle'); end if;
  token:=gen_random_uuid();
  insert into public.email_attempts(outbox_id) values(item.id);
  update public.email_outbox set status='sending',attempts=attempts+1,
    recipient=coalesce(recipient,p_recipient),claim_token=token,lease_until=now()+interval '15 minutes'
    where id=item.id returning * into item;
  return jsonb_build_object('result','claimed','id',item.id,'token',token,'payload',item.payload,'recipient',item.recipient);
end;
$$;

create function public.finish_flight_email(p_id uuid,p_token uuid,p_result text,p_provider_id text default null,p_error text default null)
returns void language plpgsql security invoker set search_path=public as $$
begin
  if p_result not in ('accepted','retry','failed') then raise exception 'Invalid email outcome'; end if;
  update public.email_outbox set
    status=case when p_result='retry' and attempts<3 and expires_at>now() then 'pending'
      when p_result='accepted' then 'accepted' else 'failed' end,
    next_attempt_at=now()+interval '1 hour',claim_token=null,lease_until=null,
    provider_id=p_provider_id,last_error=left(p_error,80),
    payload=case when p_result='retry' and attempts<3 and expires_at>now() then payload else null end,
    recipient=case when p_result='retry' and attempts<3 and expires_at>now() then recipient else null end
    where id=p_id and claim_token=p_token and status='sending';
end;
$$;

-- Turning off the database switch cancels unsent messages too. An HTTP send
-- already in flight cannot be recalled. Budget history is never reset.
create function public.cancel_pilot_emails() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  if not new.enabled then
    update public.email_outbox set status='cancelled',payload=null,recipient=null,claim_token=null
      where status in ('pending','sending');
  end if;
  return new;
end;
$$;
create trigger cancel_pilot_emails after update of enabled on public.email_settings
for each row execute function public.cancel_pilot_emails();

revoke all on function public.queue_flight_email() from public,anon,authenticated;
revoke all on function public.cancel_pilot_emails() from public,anon,authenticated;
revoke all on function public.purge_email_data() from public,anon,authenticated;
revoke all on function public.claim_flight_email(text) from public,anon,authenticated;
revoke all on function public.finish_flight_email(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.purge_email_data() to service_role;
grant execute on function public.claim_flight_email(text) to service_role;
grant execute on function public.finish_flight_email(uuid,uuid,text,text,text) to service_role;
commit;
