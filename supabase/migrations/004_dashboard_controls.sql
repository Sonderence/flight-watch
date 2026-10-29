begin;
-- Reuse the worker's global lock. Switching never removes or resets budget rows.
create function public.manage_pilot_flight(
  p_action text,p_expected_id uuid,p_number text default null,p_date date default null,
  p_origin text default null,p_destination text default null,p_departure_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare current_id uuid; new_id uuid;
begin
  perform 1 from public.worker_settings where singleton for update;
  if not found then raise exception 'Worker settings missing'; end if;
  if p_action not in ('track','stop') or p_action is null then raise exception 'Invalid action'; end if;
  select id into current_id from public.flight_monitoring where active for update;
  if current_id is distinct from p_expected_id then return jsonb_build_object('result','conflict'); end if;
  if p_action='stop' then
    update public.flight_monitoring set active=false where active;
    return jsonb_build_object('result','stopped');
  end if;
  if p_number is null or p_number !~ '^[A-Z0-9]{2,3}[0-9]{1,4}[A-Z]?$'
    or p_origin is null or p_origin !~ '^[A-Z]{3}$' or p_destination is null or p_destination !~ '^[A-Z]{3}$'
    or p_origin=p_destination or p_date is null or p_departure_at is null
    or p_departure_at<=now() or p_departure_at>now()+interval '24 hours'
    or abs(p_date-(p_departure_at at time zone 'UTC')::date)>1 then raise exception 'Invalid flight or departure outside next 24 hours'; end if;
  -- This transaction rolls back the old stop if enrollment cannot be completed.
  update public.flight_monitoring set active=false where active;
  insert into public.flight_monitoring(number,departure_date,origin,destination,departure_at,stop_at)
    values(p_number,p_date,p_origin,p_destination,p_departure_at,p_departure_at+interval '6 hours')
    returning id into new_id;
  return jsonb_build_object('result','tracking','id',new_id);
end;
$$;
revoke all on function public.manage_pilot_flight(text,uuid,text,date,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.manage_pilot_flight(text,uuid,text,date,text,text,timestamptz) to service_role;
commit;
