-- Passenger-visible rider details and active-ride location tracking.
-- Reuses the existing rides and ride_locations tables and current ride_status enum.

create or replace function public.get_ride_rider_info(p_ride_id uuid)
returns table (
  rider_id uuid,
  rider_name text,
  vehicle_type public.vehicle_type,
  vehicle_number text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select ride.rider_id,
         profile.full_name,
         rider.vehicle_type,
         rider.vehicle_number
  from public.rides as ride
  join public.profiles as profile on profile.id = ride.rider_id
  join public.riders as rider on rider.user_id = ride.rider_id
  where ride.id = p_ride_id
    and ride.rider_id is not null
    and (
      ride.passenger_id = (select auth.uid())
      or ride.rider_id = (select auth.uid())
      or (select public.is_admin())
    );
$function$;

revoke all on function public.get_ride_rider_info(uuid) from public, anon;
grant execute on function public.get_ride_rider_info(uuid) to authenticated;

-- Only the assigned rider may publish their GPS point for an active ride.
create or replace function public.record_ride_location(
  p_ride_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy double precision default null
)
returns public.ride_locations
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_location public.ride_locations;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required to share ride location';
  end if;

  if p_latitude not between -90 and 90
     or p_longitude not between -180 and 180
     or (p_accuracy is not null and (p_accuracy < 0 or p_accuracy::text in ('NaN', 'Infinity', '-Infinity'))) then
    raise exception 'A valid GPS location is required';
  end if;

  if not exists (
    select 1
    from public.rides as ride
    where ride.id = p_ride_id
      and ride.rider_id = (select auth.uid())
      and ride.status in (
        'accepted'::public.ride_status,
        'arrived'::public.ride_status,
        'picked_up'::public.ride_status,
        'in_progress'::public.ride_status
      )
  ) then
    raise exception 'Only the assigned rider can share location for an active ride';
  end if;

  insert into public.ride_locations (ride_id, actor_id, latitude, longitude, accuracy)
  values (p_ride_id, (select auth.uid()), p_latitude, p_longitude, p_accuracy)
  returning * into v_location;

  return v_location;
end;
$function$;

revoke all on function public.record_ride_location(uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.record_ride_location(uuid, double precision, double precision, double precision) to authenticated;

-- An active ride participant may read only the assigned ride's live points.
drop policy if exists ride_locations_select_participant_or_admin on public.ride_locations;
create policy ride_locations_select_participant_or_admin
  on public.ride_locations
  for select
  to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1
      from public.rides as ride
      where ride.id = ride_locations.ride_id
        and ride.status in (
          'accepted'::public.ride_status,
          'arrived'::public.ride_status,
          'picked_up'::public.ride_status,
          'in_progress'::public.ride_status
        )
        and (ride.passenger_id = (select auth.uid()) or ride.rider_id = (select auth.uid()))
    )
  );

-- Realtime is limited by the SELECT RLS policies above; no new table or publication is created.
do $publication$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'The existing supabase_realtime publication is unavailable';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rides'
  ) then
    alter publication supabase_realtime add table public.rides;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ride_locations'
  ) then
    alter publication supabase_realtime add table public.ride_locations;
  end if;
end;
$publication$;

notify pgrst, 'reload schema';
