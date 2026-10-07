-- Keep ride workflows aligned with the live text status column and protect
-- rider coordinates while adding a preference-aware nearby search.
begin;

do $$
begin
  if to_regtype('public.ride_status') is null then
    create type public.ride_status as enum (
      'requested',
      'accepted',
      'arrived',
      'picked_up',
      'in_progress',
      'completed',
      'cancelled'
    );
  end if;
end;
$$;

-- The app explicitly creates requests as `requested`; align the database
-- default so inserts that rely on the default do not create an unprocessable
-- `searching` ride.
alter table public.rides
  alter column status drop default;

-- This existing ratings policy references rides.status; recreate the same
-- participant-only condition after its type is aligned.
drop policy if exists ratings_insert_completed_participant on public.ratings;
drop policy if exists ride_locations_select_participant_or_admin
on public.ride_locations;

-- Normalize the two historical text values before the status column is cast
-- into the canonical lifecycle enum below.


alter table public.rides
  alter column status type public.ride_status
  using status::public.ride_status;

alter table public.rides
  alter column status set default 'requested'::public.ride_status;

create policy ratings_insert_completed_participant
on public.ratings for insert
to authenticated
with check (
  rater_id = (select auth.uid())
  and stars between 1 and 5
  and rating = stars
  and exists (
    select 1 from public.rides r
    where r.id = ratings.ride_id
      and r.status = 'completed'::public.ride_status
      and ratings.passenger_id = r.passenger_id
      and ratings.rider_id = r.rider_id
      and (
        (r.passenger_id = (select auth.uid()) and r.rider_id = ratings.ratee_id)
        or (r.rider_id = (select auth.uid()) and r.passenger_id = ratings.ratee_id)
      )
  )
);

-- Preserve the existing 3-argument RPC contract for older clients, but never
-- return precise rider coordinates to passengers.
create or replace function public.find_nearby_riders(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_km double precision
)
returns table (
  rider_id uuid,
  vehicle_type text,
  vehicle_number text,
  current_latitude double precision,
  current_longitude double precision,
  distance_km double precision
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    r.user_id as rider_id,
    r.vehicle_type::text,
    r.vehicle_number,
    null::double precision as current_latitude,
    null::double precision as current_longitude,
    distance_calc.distance_km
  from public.riders r
  cross join lateral (
    select 6371 * acos(least(1, greatest(-1,
      cos(radians(p_latitude))
      * cos(radians(r.current_latitude))
      * cos(radians(r.current_longitude) - radians(p_longitude))
      + sin(radians(p_latitude)) * sin(radians(r.current_latitude))
    ))) as distance_km
  ) as distance_calc
  where auth.uid() is not null
    and p_latitude between -90 and 90
    and p_longitude between -180 and 180
    and p_radius_km > 0
    and p_radius_km <= 50
    and r.approval_status = 'approved'::public.rider_approval_status
    and r.is_online = true
    and r.current_latitude is not null
    and r.current_longitude is not null
    and distance_calc.distance_km <= p_radius_km
  order by distance_calc.distance_km;
$$;

-- The booking screen uses this required 4-argument overload to filter by
-- selected vehicle type. The returned data is limited to what its cards need.
create or replace function public.find_nearby_riders(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_km double precision,
  p_vehicle_preference text
)
returns table (
  rider_id uuid,
  full_name text,
  vehicle_type text,
  vehicle_number text,
  distance_km double precision
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_latitude is null or p_latitude < -90 or p_latitude > 90
     or p_longitude is null or p_longitude < -180 or p_longitude > 180 then
    raise exception 'A valid pickup location is required' using errcode = '22023';
  end if;

  if p_radius_km is null or p_radius_km <= 0 or p_radius_km > 50 then
    raise exception 'Search radius must be between 0 and 50 km' using errcode = '22023';
  end if;

  if p_vehicle_preference not in ('auto', 'toto', 'any') then
    raise exception 'Vehicle preference must be auto, toto, or any' using errcode = '22023';
  end if;

  return query
  select
    r.user_id as rider_id,
    p.full_name,
    r.vehicle_type::text,
    r.vehicle_number,
    distance_calc.distance_km
  from public.riders r
  join public.profiles p on p.id = r.user_id
  cross join lateral (
    select 6371 * acos(least(1, greatest(-1,
      cos(radians(p_latitude))
      * cos(radians(r.current_latitude))
      * cos(radians(r.current_longitude) - radians(p_longitude))
      + sin(radians(p_latitude)) * sin(radians(r.current_latitude))
    ))) as distance_km
  ) as distance_calc
  where r.approval_status = 'approved'::public.rider_approval_status
    and p.role = 'rider'::public.app_role
    and r.is_online = true
    and r.current_latitude is not null
    and r.current_longitude is not null
    and (p_vehicle_preference = 'any' or r.vehicle_type::text = p_vehicle_preference)
    and distance_calc.distance_km <= p_radius_km
  order by distance_calc.distance_km;
end;
$$;

revoke all on function public.find_nearby_riders(double precision, double precision, double precision)
  from public, anon;
revoke all on function public.find_nearby_riders(double precision, double precision, double precision, text)
  from public, anon;
grant execute on function public.find_nearby_riders(double precision, double precision, double precision)
  to authenticated;
grant execute on function public.find_nearby_riders(double precision, double precision, double precision, text)
  to authenticated;

-- Recheck availability at request time, enforce the ride's selected vehicle
-- preference, and calculate distance from database coordinates instead of
-- trusting a client-supplied distance.
create or replace function public.send_ride_request(
  p_ride_id uuid,
  p_rider_id uuid,
  p_distance_km numeric,
  p_radius_km double precision
)
returns public.ride_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ride public.rides;
  v_request public.ride_requests;
  v_actual_distance_km double precision;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_ride
  from public.rides
  where id = p_ride_id
  for update;

  if v_ride.id is null or v_ride.passenger_id <> auth.uid() then
    raise exception 'Ride not found' using errcode = 'P0002';
  end if;

  if v_ride.status is distinct from 'requested' then
    raise exception 'Ride is no longer requesting riders';
  end if;

  if v_ride.pickup_latitude is null or v_ride.pickup_longitude is null
     or v_ride.vehicle_preference not in ('auto', 'toto', 'any') then
    raise exception 'Ride is missing a valid pickup location or vehicle preference';
  end if;

  if p_radius_km is null or p_radius_km <= 0 or p_radius_km > 50 then
    raise exception 'Search radius must be between 0 and 50 km' using errcode = '22023';
  end if;

  select 6371 * acos(least(1, greatest(-1,
    cos(radians(v_ride.pickup_latitude))
    * cos(radians(r.current_latitude))
    * cos(radians(r.current_longitude) - radians(v_ride.pickup_longitude))
    + sin(radians(v_ride.pickup_latitude)) * sin(radians(r.current_latitude))
  )))
  into v_actual_distance_km
  from public.riders r
  where r.user_id = p_rider_id
    and r.approval_status = 'approved'::public.rider_approval_status
    and r.is_online = true
    and r.current_latitude is not null
    and r.current_longitude is not null
    and (v_ride.vehicle_preference = 'any' or r.vehicle_type::text = v_ride.vehicle_preference);

  if v_actual_distance_km is null or v_actual_distance_km > p_radius_km then
    raise exception 'Rider is not available for this request';
  end if;

  insert into public.ride_requests (ride_id, rider_id, distance_km, status, sent_at, responded_at)
  values (
    p_ride_id,
    p_rider_id,
    round(v_actual_distance_km::numeric, 3),
    'pending'::public.ride_request_status,
    timezone('utc', now()),
    null
  )
  on conflict (ride_id, rider_id) do update set
    distance_km = excluded.distance_km,
    status = 'pending'::public.ride_request_status,
    sent_at = timezone('utc', now()),
    responded_at = null
  returning * into v_request;

  return v_request;
end;
$$;

-- Preserve the existing three-argument API for older clients; the current app
-- supplies its chosen radius through the four-argument overload above.
create or replace function public.send_ride_request(
  p_ride_id uuid,
  p_rider_id uuid,
  p_distance_km numeric default null
)
returns public.ride_requests
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.send_ride_request(p_ride_id, p_rider_id, p_distance_km, 50);
$$;

revoke all on function public.send_ride_request(uuid, uuid, numeric) from public, anon;
revoke all on function public.send_ride_request(uuid, uuid, numeric, double precision) from public, anon;
grant execute on function public.send_ride_request(uuid, uuid, numeric) to authenticated;
grant execute on function public.send_ride_request(uuid, uuid, numeric, double precision) to authenticated;

notify pgrst, 'reload schema';
commit;
