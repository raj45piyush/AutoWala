
-- Remove any historical permissive ride policies before recreating the
-- participant-only policy set below.
do $policies$
declare v_policy record;
begin
  for v_policy in select polname from pg_policy where polrelid='public.rides'::regclass loop
    execute format('drop policy %I on public.rides',v_policy.polname);
  end loop;
end;
$policies$;

alter table public.rides enable row level security;
alter table public.ride_locations enable row level security;
alter table public.ride_requests enable row level security;
revoke select,insert,update,delete on public.ride_passengers from public,authenticated,anon;

-- Rebuild the existing type only when it still contains deprecated labels.
-- Known policies depending on the column's enum are removed and restored below.
SELECT
  status::text AS status,
  COUNT(*) AS total
FROM public.rides
GROUP BY status::text
ORDER BY status::text;SELECT
  status::text AS status,
  COUNT(*) AS total
FROM public.rides
GROUP BY status::text
ORDER BY status::text;



alter table public.rides
  add column if not exists booking_code_hash text,
  add column if not exists booking_code_expires_at timestamptz,
  add column if not exists booking_code_attempts integer not null default 0,
  add column if not exists estimated_distance_km numeric,
  add column if not exists arrived_at timestamptz,
  add column if not exists picked_up_at timestamptz,
  add column if not exists in_progress_at timestamptz;
alter table public.rides alter column status set default 'requested'::public.ride_status;

-- Collapse earlier append-only GPS samples to the latest point per participant
-- before adding the key required for live-location upserts.
delete from public.ride_locations older using public.ride_locations newer
where older.ride_id=newer.ride_id and older.actor_id=newer.actor_id
  and (older.recorded_at<newer.recorded_at or (older.recorded_at=newer.recorded_at and older.id<newer.id));
create unique index if not exists idx_ride_locations_ride_actor_unique
  on public.ride_locations(ride_id,actor_id);
alter table public.ride_locations replica identity full;

-- Restore policies removed while the old enum was replaced.
drop policy if exists rides_select_passenger on public.rides;
create policy rides_select_passenger on public.rides for select to authenticated using (passenger_id=(select auth.uid()));
drop policy if exists rides_select_admin on public.rides;
create policy rides_select_admin on public.rides for select to authenticated using ((select public.is_admin()));

drop policy if exists ride_requests_select_participants
on public.ride_requests;

create policy ride_requests_select_participants
on public.ride_requests
for select
to authenticated
using (
  rider_id=(select auth.uid())
  or (select public.is_admin())
  or exists(
    select 1
    from public.rides r
    where r.id=ride_requests.ride_id
      and r.passenger_id=(select auth.uid())
  )
);
revoke insert,update,delete on public.ride_requests from public,authenticated,anon;
drop policy if exists ratings_insert_completed_participant on public.ratings;
create policy ratings_insert_completed_participant on public.ratings for insert to authenticated with check (
  rater_id=(select auth.uid()) and stars between 1 and 5 and rating=stars and exists(
    select 1 from public.rides r where r.id=ratings.ride_id and r.status='completed'::public.ride_status
      and ratings.passenger_id=r.passenger_id and ratings.rider_id=r.rider_id
      and ((r.passenger_id=(select auth.uid()) and r.rider_id=ratings.ratee_id) or (r.rider_id=(select auth.uid()) and r.passenger_id=ratings.ratee_id))
  )
);
drop policy if exists ride_passengers_select_rider on public.ride_passengers;
create policy ride_passengers_select_rider on public.ride_passengers for select to authenticated using (
  exists(select 1 from public.rides r where r.id=ride_passengers.ride_id and r.rider_id=(select auth.uid())
    and r.status in ('accepted'::public.ride_status,'arrived'::public.ride_status,'picked_up'::public.ride_status,'in_progress'::public.ride_status))
);

-- Allow riders to read rides with a pending targeted request. Ride mutations
-- are only performed through the guarded RPCs below.
drop policy if exists rides_select_rider on public.rides;
create policy rides_select_rider on public.rides for select to authenticated using (
  rider_id=(select auth.uid()) or exists(select 1 from public.ride_requests rr where rr.ride_id=rides.id and rr.rider_id=(select auth.uid()) and rr.status='pending')
);
drop policy if exists rides_update_rider on public.rides;
drop policy if exists rides_update_passenger on public.rides;
drop policy if exists rides_insert_passenger on public.rides;
revoke insert, update on public.rides from public,authenticated,anon;
revoke select on public.rides from public,authenticated,anon;
revoke select (booking_code_hash,booking_code_attempts) on public.rides from public,authenticated,anon;
grant select (
  id,passenger_id,rider_id,pickup_address,destination_address,pickup_latitude,pickup_longitude,
  destination_latitude,destination_longitude,passenger_count,vehicle_preference,estimated_distance_km,estimated_fare,
  final_fare,status,booking_code_expires_at,accepted_at,arrived_at,picked_up_at,in_progress_at,
  completed_at,cancelled_at,created_at,updated_at
) on public.rides to authenticated;

-- Create the request and one-time passenger code in one transaction.
create or replace function public.create_ride_with_code(
  p_pickup_address text,p_destination_address text,p_passenger_count integer,p_vehicle_preference text,
  p_pickup_latitude double precision,p_pickup_longitude double precision,
  p_destination_latitude double precision,p_destination_longitude double precision,p_estimated_fare numeric default null,
  p_estimated_distance_km numeric default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=(select auth.uid()); v_code text; v_random bytea; v_generation_attempts integer:=0; v_ride public.rides;
begin
  if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and role='user') then raise exception 'Passenger authentication required' using errcode='42501'; end if;
  if trim(coalesce(p_pickup_address,''))='' or trim(coalesce(p_destination_address,''))='' or p_passenger_count not between 1 and 8 or p_vehicle_preference not in ('auto','toto','any') then raise exception 'Invalid ride request' using errcode='22023'; end if;
  if p_pickup_latitude not between -90 and 90 or p_pickup_longitude not between -180 and 180 or p_destination_latitude not between -90 and 90 or p_destination_longitude not between -180 and 180 then raise exception 'Valid coordinates are required' using errcode='22023'; end if;
  if (p_estimated_fare is not null and p_estimated_fare<0) or (p_estimated_distance_km is not null and p_estimated_distance_km<0) then raise exception 'Fare and distance estimates cannot be negative' using errcode='22023'; end if;
  if exists(select 1 from public.rides where passenger_id=v_uid and status in ('requested','accepted','arrived','picked_up','in_progress')) then raise exception 'You already have an active ride' using errcode='23505'; end if;
  loop
    v_random:=extensions.gen_random_bytes(4);
    v_code:=lpad(((get_byte(v_random,0)::bigint*16777216+get_byte(v_random,1)::bigint*65536+get_byte(v_random,2)::bigint*256+get_byte(v_random,3)::bigint)%1000000)::text,6,'0');
    exit when not exists(select 1 from public.rides r where r.booking_code_expires_at>now()
      and r.status in ('requested','accepted','arrived','picked_up','in_progress')
      and crypt(v_code,r.booking_code_hash)=r.booking_code_hash);
    v_generation_attempts:=v_generation_attempts+1;
    if v_generation_attempts>=20 then raise exception 'Unable to create a unique active pickup code'; end if;
  end loop;
  insert into public.rides(passenger_id,pickup_address,destination_address,passenger_count,vehicle_preference,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,estimated_distance_km,estimated_fare,status,booking_code_hash,booking_code_expires_at)
  values(v_uid,trim(p_pickup_address),trim(p_destination_address),p_passenger_count,p_vehicle_preference,p_pickup_latitude,p_pickup_longitude,p_destination_latitude,p_destination_longitude,p_estimated_distance_km,p_estimated_fare,'requested',crypt(v_code,gen_salt('bf')),now()+interval '24 hours') returning * into v_ride;
  return jsonb_build_object('ride',to_jsonb(v_ride)-'booking_code_hash'-'booking_code_attempts','booking_code',v_code);
end $$;
revoke all on function public.create_ride_with_code(text,text,integer,text,double precision,double precision,double precision,double precision,numeric,numeric) from public,anon;
grant execute on function public.create_ride_with_code(text,text,integer,text,double precision,double precision,double precision,double precision,numeric,numeric) to authenticated;

-- Atomic one-rider claim; pending requests for other riders are closed on win.
create or replace function public.accept_ride(p_ride_id uuid) returns setof public.rides language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=(select auth.uid()); v_ride public.rides;
begin
  if v_uid is null or not exists(select 1 from public.riders where user_id=v_uid and approval_status='approved' and is_online) then raise exception 'Approved online rider required' using errcode='42501'; end if;
  if exists(select 1 from public.rides where rider_id=v_uid and status in ('accepted','arrived','picked_up','in_progress')) then raise exception 'You already have an active ride' using errcode='23505'; end if;
  update public.rides r set rider_id=v_uid,status='accepted',accepted_at=now(),updated_at=now()
  where r.id=p_ride_id and r.status='requested' and r.rider_id is null and r.booking_code_expires_at>now()
    and exists(select 1 from public.ride_requests q where q.ride_id=r.id and q.rider_id=v_uid and q.status='pending') returning r.* into v_ride;
  if not found then raise exception 'Ride has already been accepted or is unavailable' using errcode='23505'; end if;
  update public.ride_requests set status=case when rider_id=v_uid then 'accepted'::public.ride_request_status else 'expired'::public.ride_request_status end,responded_at=now() where ride_id=p_ride_id and status='pending';
  return query select v_ride.*;
end $$;
revoke all on function public.accept_ride(uuid) from public,anon;
grant execute on function public.accept_ride(uuid) to authenticated;
drop function if exists public.accept_ride_with_code(uuid,text);
drop function if exists public.generate_booking_code();
drop function if exists public.hash_booking_code(text);

create or replace function public.get_ride_passenger_info(p_ride_id uuid)
returns table(passenger_id uuid,passenger_name text,passenger_phone text)
language sql stable security definer set search_path=public,pg_temp as $$
  select r.passenger_id,p.full_name,
    case when r.rider_id=(select auth.uid()) or (select public.is_admin()) then p.phone else null end
  from public.rides r
  join public.profiles p on p.id=r.passenger_id
  where r.id=p_ride_id and (
    r.rider_id=(select auth.uid()) or r.passenger_id=(select auth.uid()) or (select public.is_admin())
    or exists(select 1 from public.ride_requests q where q.ride_id=r.id and q.rider_id=(select auth.uid()) and q.status='pending')
  );
$$;
revoke all on function public.get_ride_passenger_info(uuid) from public,anon;
grant execute on function public.get_ride_passenger_info(uuid) to authenticated;

drop function if exists public.get_ride_rider_info(uuid);
create function public.get_ride_rider_info(p_ride_id uuid)
returns table(rider_id uuid,rider_name text,vehicle_type public.vehicle_type,vehicle_number text,rider_rating numeric)
language sql stable security definer set search_path=public,pg_temp as $$
  select r.rider_id,p.full_name,v.vehicle_type,v.vehicle_number,round(avg(rt.stars)::numeric,1)
  from public.rides r join public.profiles p on p.id=r.rider_id
  join public.riders v on v.user_id=r.rider_id
  left join public.ratings rt on rt.ratee_id=r.rider_id
  where r.id=p_ride_id and r.rider_id is not null
    and (r.passenger_id=(select auth.uid()) or r.rider_id=(select auth.uid()) or (select public.is_admin()))
  group by r.rider_id,p.full_name,v.vehicle_type,v.vehicle_number;
$$;
revoke all on function public.get_ride_rider_info(uuid) from public,anon;
grant execute on function public.get_ride_rider_info(uuid) to authenticated;

create or replace function public.mark_rider_arrived(p_ride_id uuid) returns public.rides language plpgsql security definer set search_path=public,pg_temp as $$
declare v_ride public.rides;
begin
  update public.rides set status='arrived',arrived_at=now(),updated_at=now() where id=p_ride_id and rider_id=(select auth.uid()) and status='accepted' returning * into v_ride;
  if not found then raise exception 'Ride is not yours or is not accepted' using errcode='42501'; end if; return v_ride;
end $$;
revoke all on function public.mark_rider_arrived(uuid) from public,anon;
grant execute on function public.mark_rider_arrived(uuid) to authenticated;

-- A bad code returns an error payload after persisting an attempt. Five guesses lock the code.
create or replace function public.verify_pickup_code(p_ride_id uuid,p_code text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_ride public.rides;
begin
  select * into v_ride from public.rides where id=p_ride_id for update;
  if not found or v_ride.rider_id is distinct from (select auth.uid()) or v_ride.status<>'arrived' then raise exception 'Ride is not awaiting pickup verification for this rider' using errcode='42501'; end if;
  if v_ride.booking_code_expires_at is null or v_ride.booking_code_expires_at<now() or v_ride.booking_code_attempts>=5 then return jsonb_build_object('error','Pickup code expired or locked'); end if;
  if p_code is null or p_code !~ '^\d{6}$' or crypt(p_code,v_ride.booking_code_hash)<>v_ride.booking_code_hash then
    update public.rides set booking_code_attempts=booking_code_attempts+1 where id=p_ride_id;
    return jsonb_build_object('error','Invalid pickup code','attempts_remaining',greatest(0,4-v_ride.booking_code_attempts));
  end if;
  update public.rides set status='picked_up',picked_up_at=now(),booking_code_hash=null,updated_at=now() where id=p_ride_id returning * into v_ride;
  update public.ride_passengers set status='picked_up',picked_up_at=now() where ride_id=p_ride_id and status='waiting';
  return jsonb_build_object('ride',to_jsonb(v_ride));
end $$;
revoke all on function public.verify_pickup_code(uuid,text) from public,anon;
grant execute on function public.verify_pickup_code(uuid,text) to authenticated;
create or replace function public.mark_passenger_picked_up(p_ride_id uuid) returns public.rides language plpgsql security definer set search_path=public,pg_temp as $$ begin raise exception 'A valid pickup code is required'; end $$;
revoke all on function public.mark_passenger_picked_up(uuid) from public,anon,authenticated;

create or replace function public.start_ride_rpc(p_ride_id uuid) returns public.rides language plpgsql security definer set search_path=public,pg_temp as $$
declare v_ride public.rides;
begin update public.rides set status='in_progress',in_progress_at=now(),updated_at=now() where id=p_ride_id and rider_id=(select auth.uid()) and status='picked_up' returning * into v_ride;
if not found then raise exception 'Ride is not yours or has not been picked up' using errcode='42501'; end if; return v_ride; end $$;
revoke all on function public.start_ride_rpc(uuid) from public,anon;
grant execute on function public.start_ride_rpc(uuid) to authenticated;

create or replace function public.complete_ride_rpc(p_ride_id uuid,p_final_fare numeric default null) returns public.rides language plpgsql security definer set search_path=public,pg_temp as $$
declare v_ride public.rides;
begin
  if p_final_fare is not null and p_final_fare<0 then raise exception 'Final fare cannot be negative'; end if;
  update public.rides set status='completed',completed_at=now(),final_fare=coalesce(p_final_fare,estimated_fare),updated_at=now() where id=p_ride_id and rider_id=(select auth.uid()) and status='in_progress' returning * into v_ride;
  if not found then raise exception 'Ride is not yours or is not in progress' using errcode='42501'; end if;
  update public.ride_passengers set status='completed',completed_at=now() where ride_id=p_ride_id and status='picked_up'; return v_ride;
end $$;
revoke all on function public.complete_ride_rpc(uuid,numeric) from public,anon;
grant execute on function public.complete_ride_rpc(uuid,numeric) to authenticated;

create or replace function public.cancel_ride_rpc(p_ride_id uuid) returns public.rides language plpgsql security definer set search_path=public,pg_temp as $$
declare v_ride public.rides; v_uid uuid:=(select auth.uid());
begin
  update public.rides set status='cancelled',cancelled_at=now(),updated_at=now() where id=p_ride_id and status in ('requested','accepted','arrived') and (passenger_id=v_uid or rider_id=v_uid) returning * into v_ride;
  if not found then raise exception 'Ride is not yours or can no longer be cancelled' using errcode='42501'; end if;
  update public.ride_requests set status='cancelled',responded_at=now() where ride_id=p_ride_id and status in ('pending','accepted'); return v_ride;
end $$;
revoke all on function public.cancel_ride_rpc(uuid) from public,anon;
grant execute on function public.cancel_ride_rpc(uuid) to authenticated;

-- Participant-only upsert for live tracking. Completed and cancelled rides reject new points.
create or replace function public.record_ride_location(p_ride_id uuid,p_latitude double precision,p_longitude double precision,p_accuracy double precision default null)
returns public.ride_locations language plpgsql security definer set search_path=public,pg_temp as $$
declare v_location public.ride_locations;
begin
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180
     or (p_accuracy is not null and (p_accuracy<0 or p_accuracy::text in ('NaN','Infinity','-Infinity'))) then raise exception 'Invalid GPS coordinates'; end if;
  if not exists(select 1 from public.rides where id=p_ride_id and (rider_id=(select auth.uid()) or passenger_id=(select auth.uid())) and status in ('accepted','arrived','picked_up','in_progress')) then raise exception 'Only participants in an active ride can share location' using errcode='42501'; end if;
  insert into public.ride_locations(ride_id,actor_id,latitude,longitude,accuracy) values(p_ride_id,(select auth.uid()),p_latitude,p_longitude,p_accuracy)
  on conflict(ride_id,actor_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,accuracy=excluded.accuracy,recorded_at=now() returning * into v_location;
  return v_location;
end $$;
revoke all on function public.record_ride_location(uuid,double precision,double precision,double precision) from public,anon;
grant execute on function public.record_ride_location(uuid,double precision,double precision,double precision) to authenticated;

create or replace function public.update_passenger_location(p_latitude double precision,p_longitude double precision) returns public.ride_locations language plpgsql security definer set search_path=public,pg_temp as $$
declare v_ride_id uuid;
begin
  select id into v_ride_id from public.rides where passenger_id=(select auth.uid()) and status in ('accepted','arrived','picked_up','in_progress') order by created_at desc limit 1;
  if v_ride_id is null then raise exception 'No active ride found for this passenger'; end if;
  return public.record_ride_location(v_ride_id,p_latitude,p_longitude,null);
end $$;
revoke all on function public.update_passenger_location(double precision,double precision) from public,anon;
grant execute on function public.update_passenger_location(double precision,double precision) to authenticated;

drop policy if exists ride_locations_select_participant_or_admin on public.ride_locations;
create policy ride_locations_select_participant_or_admin on public.ride_locations for select to authenticated using (
  (select public.is_admin()) or exists(select 1 from public.rides r where r.id=ride_locations.ride_id and r.status in ('accepted','arrived','picked_up','in_progress') and (r.passenger_id=(select auth.uid()) or r.rider_id=(select auth.uid())))
);

do $pub$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rides') then alter publication supabase_realtime add table public.rides; end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='ride_locations') then alter publication supabase_realtime add table public.ride_locations; end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='ride_requests') then alter publication supabase_realtime add table public.ride_requests; end if;
  end if;
end;
$pub$;

notify pgrst,'reload schema';
commit;

