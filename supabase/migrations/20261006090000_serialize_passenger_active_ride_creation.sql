-- Serialize ride creation per passenger before checking for an active ride.
-- The check and insert already run inside this RPC transaction, but without
-- this lock two concurrent requests from the same passenger could both pass
-- the active-ride check before either insert became visible.
create or replace function public.create_ride_with_code(
  p_pickup_address text,p_destination_address text,p_passenger_count integer,p_vehicle_preference text,
  p_pickup_latitude double precision,p_pickup_longitude double precision,
  p_destination_latitude double precision,p_destination_longitude double precision,
  p_estimated_fare numeric default null,p_estimated_distance_km numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text;
  v_random bytea;
  v_attempts integer := 0;
  v_ride public.rides;
  v_config public.fare_settings;
  v_fare numeric;
  v_distance_km double precision;
begin
  if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and role='user') then
    raise exception 'Passenger authentication required' using errcode='42501';
  end if;
  if trim(coalesce(p_pickup_address,''))='' or trim(coalesce(p_destination_address,''))=''
     or p_passenger_count not between 1 and 8 or p_vehicle_preference not in ('auto','toto','any') then
    raise exception 'Invalid ride request' using errcode='22023';
  end if;
  if p_pickup_latitude is null or p_pickup_longitude is null
     or p_destination_latitude is null or p_destination_longitude is null
     or p_pickup_latitude not between -90 and 90 or p_pickup_longitude not between -180 and 180
     or p_destination_latitude not between -90 and 90 or p_destination_longitude not between -180 and 180 then
    raise exception 'Valid pickup and destination coordinates are required' using errcode='22023';
  end if;

  v_distance_km := 6371 * 2 * asin(sqrt(least(1::double precision,greatest(0::double precision,
    power(sin(radians(p_destination_latitude-p_pickup_latitude)/2),2)
    +cos(radians(p_pickup_latitude))*cos(radians(p_destination_latitude))
      *power(sin(radians(p_destination_longitude-p_pickup_longitude)/2),2)
  ))));
  if v_distance_km <= 0 or v_distance_km > 1000 then
    raise exception 'Pickup and destination must be a valid trip distance apart' using errcode='22023';
  end if;

  -- Every create_ride_with_code call for this passenger takes the same
  -- transaction-scoped lock, making the active-ride check and insert atomic
  -- with respect to other booking attempts by this passenger.
  perform pg_advisory_xact_lock(hashtextextended('autowala_active_ride:' || v_uid::text, 0));
  if exists(
    select 1 from public.rides
    where passenger_id=v_uid and status in ('requested','accepted','arrived','picked_up','in_progress')
  ) then
    raise exception 'You already have an active ride' using errcode='23505';
  end if;

  select * into strict v_config from public.fare_settings where id=1;
  v_fare := round(greatest(v_config.minimum_fare,
    v_config.base_fare + v_distance_km*v_config.per_km_rate
      + v_config.platform_fee + v_config.tax),2);
  if v_fare > 99999999.99 then raise exception 'Calculated fare exceeds the supported limit'; end if;

  -- Retain the existing global lock for unique active pickup-code generation.
  perform pg_advisory_xact_lock(hashtext('autowala_active_pickup_code'));
  loop
    v_random := extensions.gen_random_bytes(4);
    v_code := lpad(((get_byte(v_random,0)::bigint*16777216
      +get_byte(v_random,1)::bigint*65536+get_byte(v_random,2)::bigint*256
      +get_byte(v_random,3)::bigint)%1000000)::text,6,'0');
    exit when not exists(
      select 1 from public.rides r where r.booking_code_expires_at>now()
        and r.status in ('requested','accepted','arrived','picked_up','in_progress')
        and extensions.crypt(v_code,r.booking_code_hash)=r.booking_code_hash
    );
    v_attempts:=v_attempts+1;
    if v_attempts>=20 then raise exception 'Unable to create a unique active pickup code'; end if;
  end loop;

  insert into public.rides(
    passenger_id,pickup_address,destination_address,passenger_count,vehicle_preference,
    pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,
    estimated_distance_km,estimated_fare,fare_config_snapshot,status,booking_code_hash,booking_code_expires_at
  ) values(
    v_uid,trim(p_pickup_address),trim(p_destination_address),p_passenger_count,p_vehicle_preference,
    p_pickup_latitude,p_pickup_longitude,p_destination_latitude,p_destination_longitude,
    v_distance_km,v_fare,
    jsonb_build_object('base_fare',v_config.base_fare,'per_km_rate',v_config.per_km_rate,
      'minimum_fare',v_config.minimum_fare,'platform_fee',v_config.platform_fee,'tax',v_config.tax),
    'requested',extensions.crypt(v_code,extensions.gen_salt('bf')),now()+interval '24 hours'
  ) returning * into v_ride;
  return jsonb_build_object('ride',to_jsonb(v_ride)-'booking_code_hash'-'booking_code_attempts','booking_code',v_code);
end;
$$;
revoke all on function public.create_ride_with_code(text,text,integer,text,double precision,double precision,double precision,double precision,numeric,numeric) from public, anon;
grant execute on function public.create_ride_with_code(text,text,integer,text,double precision,double precision,double precision,double precision,numeric,numeric) to authenticated;
