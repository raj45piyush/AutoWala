-- Restore the app's authenticated table permissions. RLS remains enabled and
-- continues to decide which rows each role can read or change.
begin;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'rider_approval_status'
  ) then
    create type public.rider_approval_status as enum ('pending', 'approved', 'rejected', 'blocked');
  end if;
end;
$$;

-- The live riders table has the approval enum but is missing the column used
-- by the app and its RPCs. Leave existing rows NULL so they require review;
-- new rider signups are explicitly inserted as pending below.
alter table public.riders
  add column if not exists approval_status public.rider_approval_status;

comment on column public.riders.approval_status is
  'Administrator-controlled onboarding status. Existing NULL values require review.';

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.riders to authenticated;
grant select, insert, update on public.rides to authenticated;
grant select, insert, update on public.complaints to authenticated;
grant select, update on public.payments to authenticated;
grant select, insert on public.ratings to authenticated;
grant select on public.ride_requests to authenticated;
grant select on public.ride_locations to authenticated;
grant select, update on public.notifications to authenticated;

-- The existing update guard blocks profile role changes for authenticated
-- non-admins. Allow trusted SQL Editor/service-role operations (no user JWT)
-- to promote a selected Auth account, and block authenticated admin inserts.
create or replace function public.prevent_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only an administrator can change account roles';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_client_admin_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role = 'admin'::public.app_role and auth.uid() is not null then
    raise exception 'Only a database administrator can assign the admin role';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_client_admin_profile_insert on public.profiles;
create trigger prevent_client_admin_profile_insert
before insert on public.profiles
for each row execute function public.prevent_client_admin_profile_insert();

-- Riders can create only their own pending, offline rider record. Approval
-- remains an administrator-only action enforced below and by the existing
-- riders_update_self_or_admin RLS policy.
drop policy if exists riders_insert_self_pending on public.riders;
create policy riders_insert_self_pending
on public.riders for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and profile_id = (select auth.uid())
  and approval_status = 'pending'::public.rider_approval_status
  and is_online = false
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'rider'::public.app_role
  )
);

-- A rating is allowed only from a participant of a completed ride, and the
-- rated user must be the other participant.
drop policy if exists ratings_insert_completed_participant on public.ratings;
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
      and r.status = 'completed'
      and ratings.passenger_id = r.passenger_id
      and ratings.rider_id = r.rider_id
      and (
        (r.passenger_id = (select auth.uid()) and r.rider_id = ratings.ratee_id)
        or (r.rider_id = (select auth.uid()) and r.passenger_id = ratings.ratee_id)
      )
  )
);

-- Keep the nearby rider RPC's existing return contract and enforce approval
-- in SQL so unapproved riders never receive requests through this function.
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
    r.current_latitude,
    r.current_longitude,
    (
      6371 * acos(least(1, greatest(-1,
        cos(radians(p_latitude))
        * cos(radians(r.current_latitude))
        * cos(radians(r.current_longitude) - radians(p_longitude))
        + sin(radians(p_latitude)) * sin(radians(r.current_latitude))
      )))
    ) as distance_km
  from public.riders r
  where r.approval_status = 'approved'::public.rider_approval_status
    and r.is_online = true
    and r.current_latitude is not null
    and r.current_longitude is not null
    and (
      6371 * acos(least(1, greatest(-1,
        cos(radians(p_latitude))
        * cos(radians(r.current_latitude))
        * cos(radians(r.current_longitude) - radians(p_longitude))
        + sin(radians(p_latitude)) * sin(radians(r.current_latitude))
      )))
    ) <= p_radius_km
  order by distance_km;
$$;

revoke all on function public.find_nearby_riders(double precision, double precision, double precision) from public, anon;
grant execute on function public.find_nearby_riders(double precision, double precision, double precision) to authenticated;

-- The app's rider fallback can repair missing rider details. Keep the auth
-- trigger as the primary path and set both required owner columns there.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  profile_age smallint;
  profile_role public.app_role;
  profile_vehicle public.vehicle_type;
begin
  profile_role := case
    when metadata ->> 'role' = 'rider' then 'rider'::public.app_role
    else 'user'::public.app_role
  end;

  if trim(coalesce(metadata ->> 'age', '')) ~ '^\d{1,3}$' then
    profile_age := (metadata ->> 'age')::smallint;
    if profile_age < 10 or profile_age > 120 then
      profile_age := null;
    end if;
  end if;

  insert into public.profiles (id, full_name, age, phone, email, role)
  values (
    new.id,
    coalesce(nullif(trim(metadata ->> 'full_name'), ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'AutoWala user'),
    profile_age,
    nullif(trim(metadata ->> 'phone'), ''),
    new.email,
    profile_role
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = case
      when public.profiles.full_name = 'AutoWala user' then excluded.full_name
      else public.profiles.full_name
    end;

  if profile_role = 'rider'::public.app_role then
    profile_vehicle := case
      when lower(coalesce(metadata ->> 'vehicle_type', 'auto')) = 'toto'
        then 'toto'::public.vehicle_type
      else 'auto'::public.vehicle_type
    end;

    insert into public.riders (
      profile_id,
      user_id,
      vehicle_type,
      vehicle_number,
      vehicle_details,
      licence_number,
      id_proof_type,
      approval_status,
      is_online
    )
    values (
      new.id,
      new.id,
      profile_vehicle,
      nullif(trim(metadata ->> 'vehicle_number'), ''),
      nullif(trim(metadata ->> 'vehicle_details'), ''),
      nullif(trim(metadata ->> 'licence_number'), ''),
      nullif(trim(metadata ->> 'id_proof_type'), ''),
      'pending'::public.rider_approval_status,
      false
    )
    on conflict (user_id) do update set
      profile_id = excluded.profile_id,
      vehicle_type = excluded.vehicle_type,
      vehicle_number = coalesce(excluded.vehicle_number, public.riders.vehicle_number),
      vehicle_details = coalesce(excluded.vehicle_details, public.riders.vehicle_details),
      licence_number = coalesce(excluded.licence_number, public.riders.licence_number),
      id_proof_type = coalesce(excluded.id_proof_type, public.riders.id_proof_type);
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- Aggregate payments inside Postgres so the dashboard summary covers all
-- payments without downloading the entire payment table.
create or replace function public.get_admin_financial_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'payments', count(*),
      'paidPayments', count(*) filter (where payment_status = 'paid'::public.payment_status),
      'totalPaid', coalesce(sum(amount) filter (where payment_status = 'paid'::public.payment_status), 0),
      'pendingPaymentAmount', coalesce(sum(amount) filter (where payment_status = 'pending'::public.payment_status), 0)
    )
    from public.payments
  );
end;
$$;

revoke all on function public.get_admin_financial_summary() from public, anon;
grant execute on function public.get_admin_financial_summary() to authenticated;

notify pgrst, 'reload schema';

commit;
