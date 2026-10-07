-- Idempotent repair for the existing auth.users -> profiles/riders trigger.
-- Apply after 20260927090000_admin_panel_permissions.sql so the approval
-- status type and column exist. This preserves the shared Auth flow and
-- accepts only user/rider registration metadata, never an admin role.

begin;

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

  if trim(coalesce(metadata ->> 'age', '')) ~ '^[0-9]{1,3}$' then
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

commit;
