-- Ride state machine, booking code, multi-passenger support, and secure RPC functions
begin;

-- 1. Update ride_status enum with new states
do $$
begin
  if not exists (select 1 from pg_enum where enumlabel = 'arrived' and enumtypid = 'public.ride_status'::regtype) then
    alter type public.ride_status add value 'arrived';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'picked_up' and enumtypid = 'public.ride_status'::regtype) then
    alter type public.ride_status add value 'picked_up';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'in_progress' and enumtypid = 'public.ride_status'::regtype) then
    alter type public.ride_status add value 'in_progress';
  end if;
end;
$$;

-- 2. Add booking_code column to rides table (store hash for security)
alter table public.rides
  add column if not exists booking_code_hash text,
  add column if not exists booking_code_expires_at timestamptz,
  add column if not exists arrived_at timestamptz,
  add column if not exists picked_up_at timestamptz,
  add column if not exists in_progress_at timestamptz;

-- Create index for booking code lookups
create index if not exists idx_rides_booking_code_hash on public.rides (booking_code_hash) where booking_code_hash is not null;

-- 3. Create ride_passengers table for multi-passenger shared rides
create table if not exists public.ride_passengers (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  passenger_id uuid not null references public.profiles(id) on delete cascade,
  booking_code_hash text not null,
  status text not null default 'waiting' check (status in ('waiting', 'picked_up', 'completed', 'cancelled')),
  joined_at timestamptz not null default timezone('utc', now()),
  picked_up_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
);

-- Index for ride_passengers lookups
create index if not exists idx_ride_passengers_ride_id on public.ride_passengers (ride_id);
create index if not exists idx_ride_passengers_passenger_id on public.ride_passengers (passenger_id);
create index if not exists idx_ride_passengers_booking_code_hash on public.ride_passengers (booking_code_hash) where booking_code_hash is not null;

-- Unique constraint: one passenger per ride (can be extended later)
alter table public.ride_passengers
  add constraint ride_passengers_ride_id_passenger_id_key unique (ride_id, passenger_id);

-- Enable RLS on ride_passengers
alter table public.ride_passengers enable row level security;

-- RLS: Passenger can see their own ride_passengers entries
create policy ride_passengers_select_own on public.ride_passengers
  for select to authenticated
  using (passenger_id = (select auth.uid()));

-- RLS: Rider can see passengers for their assigned ride
create policy ride_passengers_select_rider on public.ride_passengers
  for select to authenticated
  using (
    exists (
      select 1 from public.rides r
      where r.id = ride_passengers.ride_id
        and r.rider_id = (select auth.uid())
        and r.status in ('accepted'::public.ride_status, 'arrived'::public.ride_status, 'picked_up'::public.ride_status, 'in_progress'::public.ride_status)
    )
  );

-- RLS: Admin can see all
create policy ride_passengers_select_admin on public.ride_passengers
  for select to authenticated
  using ((select public.is_admin()));

-- 4. Function to generate secure 6-digit booking code
create or replace function public.generate_booking_code()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_hash text;
  v_attempts int := 0;
begin
  loop
    v_code := lpad(floor(random() * 1000000)::text, 6, '0');
    v_hash := crypt(v_code, gen_salt('bf'));
    
    -- Check uniqueness among active rides
    if not exists (
      select 1 from public.rides
      where booking_code_hash = v_hash
        and status in ('requested'::public.ride_status, 'accepted'::public.ride_status, 'arrived'::public.ride_status, 'picked_up'::public.ride_status, 'in_progress'::public.ride_status)
    ) and not exists (
      select 1 from public.ride_passengers
      where booking_code_hash = v_hash
        and status in ('waiting', 'picked_up')
    ) then
      return v_code;
    end if;
    
    v_attempts := v_attempts + 1;
    if v_attempts > 10 then
      raise exception 'Unable to generate unique booking code';
    end if;
  end loop;
end;
$$;

revoke all on function public.generate_booking_code() from public, anon;
grant execute on function public.generate_booking_code() to authenticated;

-- 4b. Function to hash a booking code (for client-side generation if needed)
create or replace function public.hash_booking_code(p_code text)
returns text
language sql
security definer
set search_path = public, pg_temp
as $$
  select extensions.crypt(p_code, extensions.gen_salt('bf'));
$$;




revoke all on function public.hash_booking_code(text) from public, anon;
grant execute on function public.hash_booking_code(text) to authenticated;

-- 5. Atomic accept_ride_with_code RPC - prevents double booking
create or replace function public.accept_ride_with_code(
  p_ride_id uuid,
  p_booking_code text
)
returns public.rides
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ride public.rides;
  v_rider_id uuid := (select auth.uid());
  v_code_hash text;
  v_passenger_id uuid;
begin
  if v_rider_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_booking_code is null or p_booking_code !~ '^\d{6}$' then
    raise exception 'Invalid booking code format' using errcode = '22023';
  end if;

  -- Check rider is approved and online
  if not exists (
    select 1 from public.riders
    where user_id = v_rider_id
      and approval_status = 'approved'::public.rider_approval_status
      and is_online = true
  ) then
    raise exception 'Rider is not approved or not online' using errcode = '42501';
  end if;

  -- Check rider doesn't have overlapping active ride
  if exists (
    select 1 from public.rides
    where rider_id = v_rider_id
      and status in ('accepted'::public.ride_status, 'arrived'::public.ride_status, 'picked_up'::public.ride_status, 'in_progress'::public.ride_status)
  ) then
    raise exception 'You already have an active ride. Complete the current ride before accepting another.' using errcode = '40901';
  end if;

  -- Atomic update: claim the ride if it matches all criteria
  update public.rides
  set rider_id = v_rider_id,
      status = 'accepted'::public.ride_status,
      accepted_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_ride_id
    and status = 'requested'::public.ride_status
    and rider_id is null
    and booking_code_hash = crypt(p_booking_code, booking_code_hash)
  returning * into v_ride;

  if not found then
    -- Check why it failed
    if exists (
      select 1 from public.rides
      where id = p_ride_id
        and status = 'requested'::public.ride_status
        and rider_id is null
    ) then
      raise exception 'Invalid ride code. Ask the passenger for the correct code.' using errcode = '40301';
    elsif exists (
      select 1 from public.rides
      where id = p_ride_id
        and rider_id is not null
    ) then
      raise exception 'This ride has already been accepted by another rider.' using errcode = '40902';
    else
      raise exception 'Ride not found or no longer available' using errcode = 'P0002';
    end if;
  end if;

  -- Insert into ride_passengers for the primary passenger
  insert into public.ride_passengers (ride_id, passenger_id, booking_code_hash, status)
  values (v_ride.id, v_ride.passenger_id, v_ride.booking_code_hash, 'waiting')
  on conflict (ride_id, passenger_id) do nothing;

  return v_ride;
end;
$$;

revoke all on function public.accept_ride_with_code(uuid, text) from public, anon;
grant execute on function public.accept_ride_with_code(uuid, text) to authenticated;

-- 6. mark_rider_arrived RPC
create or replace function public.mark_rider_arrived(
  p_ride_id uuid
)
returns public.rides
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ride public.rides;
  v_rider_id uuid := (select auth.uid());
begin
  if v_rider_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.rides
  set status = 'arrived'::public.ride_status,
      arrived_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_ride_id
    and rider_id = v_rider_id
    and status = 'accepted'::public.ride_status
  returning * into v_ride;

  if not found then
    raise exception 'Ride not found, not assigned to you, or not in accepted status' using errcode = 'P0002';
  end if;

  return v_ride;
end;
$$;

revoke all on function public.mark_rider_arrived(uuid) from public, anon;
grant execute on function public.mark_rider_arrived(uuid) to authenticated;

-- 7. mark_passenger_picked_up RPC
create or replace function public.mark_passenger_picked_up(
  p_ride_id uuid
)
returns public.rides
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ride public.rides;
  v_rider_id uuid := (select auth.uid());
begin
  if v_rider_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.rides
  set status = 'picked_up'::public.ride_status,
      picked_up_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_ride_id
    and rider_id = v_rider_id
    and status = 'arrived'::public.ride_status
  returning * into v_ride;

  if not found then
    raise exception 'Ride not found, not assigned to you, or not in arrived status' using errcode = 'P0002';
  end if;

  -- Update ride_passengers status
  update public.ride_passengers
  set status = 'picked_up',
      picked_up_at = timezone('utc', now())
  where ride_id = p_ride_id
    and status = 'waiting';

  return v_ride;
end;
$$;

revoke all on function public.mark_passenger_picked_up(uuid) from public, anon;
grant execute on function public.mark_passenger_picked_up(uuid) to authenticated;

-- 8. start_ride RPC (IN_PROGRESS)
create or replace function public.start_ride_rpc(
  p_ride_id uuid
)
returns public.rides
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ride public.rides;
  v_rider_id uuid := (select auth.uid());
begin
  if v_rider_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.rides
  set status = 'in_progress'::public.ride_status,
      in_progress_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_ride_id
    and rider_id = v_rider_id
    and status = 'picked_up'::public.ride_status
  returning * into v_ride;

  if not found then
    raise exception 'Ride not found, not assigned to you, or not in picked_up status' using errcode = 'P0002';
  end if;

  return v_ride;
end;
$$;

revoke all on function public.start_ride_rpc(uuid) from public, anon;
grant execute on function public.start_ride_rpc(uuid) to authenticated;

-- 9. complete_ride RPC with validation
create or replace function public.complete_ride_rpc(
  p_ride_id uuid,
  p_final_fare numeric default null
)
returns public.rides
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ride public.rides;
  v_rider_id uuid := (select auth.uid());
begin
  if v_rider_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.rides
  set status = 'completed'::public.ride_status,
      completed_at = timezone('utc', now()),
      final_fare = p_final_fare,
      updated_at = timezone('utc', now())
  where id = p_ride_id
    and rider_id = v_rider_id
    and status = 'in_progress'::public.ride_status
  returning * into v_ride;

  if not found then
    raise exception 'Ride not found, not assigned to you, or not in progress' using errcode = 'P0002';
  end if;

  -- Update ride_passengers status
  update public.ride_passengers
  set status = 'completed',
      completed_at = timezone('utc', now())
  where ride_id = p_ride_id
    and status = 'picked_up';

  return v_ride;
end;
$$;

revoke all on function public.complete_ride_rpc(uuid, numeric) from public, anon;
grant execute on function public.complete_ride_rpc(uuid, numeric) to authenticated;

-- 10. cancel_ride RPC with validation (passenger can cancel if requested/accepted, rider if accepted/arrived)
create or replace function public.cancel_ride_rpc(
  p_ride_id uuid
)
returns public.rides
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ride public.rides;
  v_user_id uuid := (select auth.uid());
  v_role public.app_role;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = v_user_id;

  if v_role = 'user' then
    -- Passenger can cancel if requested or accepted (before rider arrives)
    update public.rides
    set status = 'cancelled'::public.ride_status,
        cancelled_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = p_ride_id
      and passenger_id = v_user_id
      and status in ('requested'::public.ride_status, 'accepted'::public.ride_status)
    returning * into v_ride;
  elsif v_role = 'rider' then
    -- Rider can cancel if accepted or arrived (before pickup)
    update public.rides
    set status = 'cancelled'::public.ride_status,
        cancelled_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = p_ride_id
      and rider_id = v_user_id
      and status in ('accepted'::public.ride_status, 'arrived'::public.ride_status)
    returning * into v_ride;
  else
    raise exception 'Only passenger or rider can cancel' using errcode = '42501';
  end if;

  if not found then
    raise exception 'Ride not found, not authorized, or cannot be cancelled in current status' using errcode = 'P0002';
  end if;

  -- Update ride_passengers status
  update public.ride_passengers
  set status = 'cancelled',
      cancelled_at = timezone('utc', now())
  where ride_id = p_ride_id
    and status in ('waiting', 'picked_up');

  return v_ride;
end;
$$;

revoke all on function public.cancel_ride_rpc(uuid) from public, anon;
grant execute on function public.cancel_ride_rpc(uuid) to authenticated;

-- 11. Get ride passenger info RPC (for rider to see passenger details)
create or replace function public.get_ride_passenger_info(
  p_ride_id uuid
)
returns table (
  passenger_id uuid,
  passenger_name text,
  passenger_phone text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ride.passenger_id,
         profile.full_name,
         profile.phone
  from public.rides as ride
  join public.profiles as profile on profile.id = ride.passenger_id
  where ride.id = p_ride_id
    and (
      ride.rider_id = (select auth.uid())
      or ride.passenger_id = (select auth.uid())
      or (select public.is_admin())
    );
$$;

revoke all on function public.get_ride_passenger_info(uuid) from public, anon;
grant execute on function public.get_ride_passenger_info(uuid) to authenticated;

-- 12. Get ride passengers for multi-passenger view
create or replace function public.get_ride_passengers(
  p_ride_id uuid
)
returns table (
  passenger_id uuid,
  passenger_name text,
  passenger_phone text,
  status text,
  joined_at timestamptz,
  picked_up_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rp.passenger_id,
         p.full_name,
         p.phone,
         rp.status,
         rp.joined_at,
         rp.picked_up_at
  from public.ride_passengers rp
  join public.profiles p on p.id = rp.passenger_id
  where rp.ride_id = p_ride_id
    and (
      exists (select 1 from public.rides r where r.id = p_ride_id and r.rider_id = (select auth.uid()))
      or rp.passenger_id = (select auth.uid())
      or (select public.is_admin())
    )
  order by rp.joined_at;
$$;

revoke all on function public.get_ride_passengers(uuid) from public, anon;
grant execute on function public.get_ride_passengers(uuid) to authenticated;

-- 13. RLS policy for rides - passenger can see their own rides
drop policy if exists rides_select_passenger on public.rides;
create policy rides_select_passenger
  on public.rides for select
  to authenticated
  using (passenger_id = (select auth.uid()));

-- RLS policy for rides - rider can see their assigned rides
drop policy if exists rides_select_rider on public.rides;
create policy rides_select_rider
  on public.rides for select
  to authenticated
  using (rider_id = (select auth.uid()));

-- RLS policy for rides - admin can see all
drop policy if exists rides_select_admin on public.rides;
create policy rides_select_admin
  on public.rides for select
  to authenticated
  using ((select public.is_admin()));

-- RLS policy for rides - passenger can insert their own rides
drop policy if exists rides_insert_passenger on public.rides;
create policy rides_insert_passenger
  on public.rides for insert
  to authenticated
  with check (passenger_id = (select auth.uid()));

-- RLS policy for rides - rider can update their assigned rides (status transitions validated in RPCs)
drop policy if exists rides_update_rider on public.rides;
create policy rides_update_rider
  on public.rides for update
  to authenticated
  using (rider_id = (select auth.uid()))
  with check (rider_id = (select auth.uid()));

-- RLS policy for rides - passenger can update their own rides (cancel only)
drop policy if exists rides_update_passenger on public.rides;
create policy rides_update_passenger
  on public.rides for update
  to authenticated
  using (passenger_id = (select auth.uid()))
  with check (passenger_id = (select auth.uid()));

-- 14. Add ride_locations unique constraint for upsert
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ride_locations_ride_id_actor_id_key'
      and conrelid = 'public.ride_locations'::regclass
  ) then
    alter table public.ride_locations
      add constraint ride_locations_ride_id_actor_id_key unique (ride_id, actor_id);
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
