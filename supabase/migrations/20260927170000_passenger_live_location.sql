-- Passenger live location tracking during active rides.
-- Reuses the existing ride_locations table with actor_id = passenger user_id.

create or replace function public.update_passenger_location(
  p_latitude double precision,
  p_longitude double precision
)
returns public.ride_locations
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_ride public.rides;
  v_location public.ride_locations;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required to share location';
  end if;

  if p_latitude not between -90 and 90
     or p_longitude not between -180 and 180 then
    raise exception 'A valid GPS location is required';
  end if;

  -- Find the passenger's active ride
  select * into v_ride
  from public.rides
  where passenger_id = (select auth.uid())
    and status in (
      'accepted'::public.ride_status,
      'arrived'::public.ride_status,
      'picked_up'::public.ride_status,
      'in_progress'::public.ride_status
    )
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'No active ride found for this passenger';
  end if;

  -- Upsert passenger location in ride_locations
  insert into public.ride_locations (ride_id, actor_id, latitude, longitude, accuracy)
  values (v_ride.id, (select auth.uid()), p_latitude, p_longitude, null)
  on conflict (ride_id, actor_id) do update set
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    accuracy = excluded.accuracy,
    recorded_at = timezone('utc', now())
  returning * into v_location;

  return v_location;
end;
$function$;

revoke all on function public.update_passenger_location(double precision, double precision) from public, anon;
grant execute on function public.update_passenger_location(double precision, double precision) to authenticated;

notify pgrst, 'reload schema';
