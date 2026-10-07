begin;

-- These deployed policies contain expressions typed as public.ride_status.
drop policy if exists ratings_insert_completed_participant on public.ratings;
drop policy if exists ride_locations_select_participant_or_admin on public.ride_locations;
drop policy if exists ride_passengers_select_rider on public.ride_passengers;
drop policy if exists rides_select_passenger on public.rides;
drop policy if exists rides_select_admin on public.rides;
drop policy if exists rides_select_rider on public.rides;

-- Use canonical notification names for new writes, and preserve legacy rows
-- until they are converted below.
create or replace function public.sync_notification_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_type text := lower(coalesce(nullif(btrim(new.type), ''), ''));
begin
  if new.kind is null then
    new.kind := case v_type
      when 'ride_request' then 'ride_request'::public.notification_kind
      when 'ride_accepted' then 'ride_accepted'::public.notification_kind
      when 'rider_arriving' then 'rider_arrived'::public.notification_kind
      when 'rider_arrived' then 'rider_arrived'::public.notification_kind
      when 'passenger_picked_up' then 'passenger_picked_up'::public.notification_kind
      when 'ride_started' then 'ride_in_progress'::public.notification_kind
      when 'ride_in_progress' then 'ride_in_progress'::public.notification_kind
      when 'ride_cancelled' then 'ride_cancelled'::public.notification_kind
      when 'ride_completed' then 'ride_completed'::public.notification_kind
      when 'rider_approval' then 'rider_approval'::public.notification_kind
      else 'payment_status'::public.notification_kind
    end;
  end if;

  new.type := case v_type
    when 'rider_arriving' then 'rider_arrived'
    when 'ride_started' then 'ride_in_progress'
    when '' then new.kind::text
    else v_type
  end;
  new.message := coalesce(nullif(btrim(new.message), ''), new.body, new.title);
  new.body := coalesce(nullif(btrim(new.body), ''), new.message, new.title);
  if new.read then
    new.read_at := coalesce(new.read_at, timezone('utc', now()));
  elsif new.read_at is not null then
    new.read := true;
  end if;
  return new;
end;
$$;

create or replace function public.notify_ride_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kind public.notification_kind;
  v_title text;
  v_body text;
begin
  if new.status is not distinct from old.status then return new; end if;
  case new.status::text
    when 'accepted' then
      v_kind := 'ride_accepted'; v_title := 'Ride accepted';
      v_body := 'Your AutoWala rider has accepted the ride.';
    when 'arrived' then
      v_kind := 'rider_arrived'; v_title := 'Rider has arrived';
      v_body := 'Your rider has reached the pickup location.';
    when 'picked_up' then
      v_kind := 'passenger_picked_up'; v_title := 'Passenger picked up';
      v_body := 'Your pickup code was verified.';
    when 'in_progress' then
      v_kind := 'ride_in_progress'; v_title := 'Ride started';
      v_body := 'Your AutoWala ride is in progress.';
    when 'completed' then
      v_kind := 'ride_completed'; v_title := 'Ride completed';
      v_body := 'Your AutoWala ride is complete.';
    when 'cancelled' then
      v_kind := 'ride_cancelled'; v_title := 'Ride cancelled';
      v_body := 'Your AutoWala ride was cancelled.';
    else return new;
  end case;
  insert into public.notifications(user_id, kind, title, body, data)
  values(new.passenger_id, v_kind, v_title, v_body, jsonb_build_object('ride_id', new.id));
  return new;
end;
$$;

update public.notifications
set kind = case kind::text
      when 'rider_arriving' then 'rider_arrived'::public.notification_kind
      when 'ride_started' then 'ride_in_progress'::public.notification_kind
      else kind::text::public.notification_kind
    end,
    type = case lower(coalesce(type, ''))
      when 'rider_arriving' then 'rider_arrived'
      when 'ride_started' then 'ride_in_progress'
      else type
    end;

-- Correct the database enum in place. Historical rows are translated to their
-- nearest supported live state; no second ride_status type remains afterwards.
alter table public.rides alter column status drop default;
do $ride_status$
declare v_labels text[];
begin
  select array_agg(e.enumlabel order by e.enumsortorder)
    into v_labels
  from pg_enum e
  where e.enumtypid = 'public.ride_status'::regtype;

  if v_labels is distinct from array[
    'requested','accepted','arrived','picked_up','in_progress','completed','cancelled'
  ]::text[] then
    alter type public.ride_status rename to ride_status_legacy;
    create type public.ride_status as enum (
      'requested','accepted','arrived','picked_up','in_progress','completed','cancelled'
    );
    alter table public.rides
      alter column status type public.ride_status
      using (
        case status::text
          when 'arriving' then 'accepted'
          when 'started' then 'in_progress'
          else status::text
        end
      )::public.ride_status;
    drop type public.ride_status_legacy;
  end if;
end;
$ride_status$;
alter table public.rides alter column status set default 'requested'::public.ride_status;

-- Restore the participant-scoped read rules using the replacement enum.
create policy rides_select_passenger on public.rides for select to authenticated
  using (passenger_id = (select auth.uid()));
create policy rides_select_admin on public.rides for select to authenticated
  using ((select public.is_admin()));
create policy rides_select_rider on public.rides for select to authenticated
  using (
    rider_id = (select auth.uid())
    or exists (
      select 1 from public.ride_requests rr
      where rr.ride_id = rides.id
        and rr.rider_id = (select auth.uid())
        and rr.status = 'pending'
    )
  );
create policy ratings_insert_completed_participant on public.ratings for insert to authenticated
  with check (
    rater_id = (select auth.uid())
    and stars between 1 and 5 and rating = stars
    and exists (
      select 1 from public.rides r
      where r.id = ratings.ride_id and r.status = 'completed'::public.ride_status
        and ratings.passenger_id = r.passenger_id and ratings.rider_id = r.rider_id
        and (
          (r.passenger_id = (select auth.uid()) and r.rider_id = ratings.ratee_id)
          or (r.rider_id = (select auth.uid()) and r.passenger_id = ratings.ratee_id)
        )
    )
  );
create policy ride_passengers_select_rider on public.ride_passengers for select to authenticated
  using (
    exists (
      select 1 from public.rides r
      where r.id = ride_passengers.ride_id and r.rider_id = (select auth.uid())
        and r.status in ('accepted','arrived','picked_up','in_progress')
    )
  );
create policy ride_locations_select_participant_or_admin on public.ride_locations for select to authenticated
  using (
    (select public.is_admin()) or exists (
      select 1 from public.rides r
      where r.id = ride_locations.ride_id
        and r.status in ('accepted','arrived','picked_up','in_progress')
        and (r.passenger_id = (select auth.uid()) or r.rider_id = (select auth.uid()))
    )
  );

-- The transition bypass is transaction-local and only set inside the secured
-- ride RPCs. Clients cannot write rides directly.
create or replace function public.validate_ride_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_transition_allowed boolean := coalesce(current_setting('autowala.ride_transition', true), '') = 'allowed';
  v_admin boolean := public.is_admin();
begin
  if new.passenger_id is distinct from old.passenger_id then
    raise exception 'A ride passenger cannot be changed';
  end if;
  if new.rider_id is distinct from old.rider_id and not v_transition_allowed and not v_admin then
    raise exception 'Ride assignment can only be changed by the matching service';
  end if;
  if new.status is distinct from old.status and not v_transition_allowed and not v_admin then
    if not (
      old.passenger_id = (select auth.uid())
      and new.status = 'cancelled'::public.ride_status
      and old.status in ('requested'::public.ride_status,'accepted'::public.ride_status,'arrived'::public.ride_status)
    ) then
      raise exception 'Ride status can only be changed by the ride workflow';
    end if;
  end if;
  return new;
end;
$$;

-- Remove RPCs that skipped pickup verification or wrote retired states.
drop function if exists public.mark_rider_arriving(uuid);
drop function if exists public.start_ride(uuid);
drop function if exists public.complete_ride(uuid, numeric);
drop function if exists public.cancel_ride(uuid);
drop function if exists public.accept_ride(uuid);
drop function if exists public.mark_rider_arrived(uuid);
drop function if exists public.start_ride_rpc(uuid);
drop function if exists public.complete_ride_rpc(uuid, numeric);
drop function if exists public.cancel_ride_rpc(uuid);

-- Keep ride claiming atomic and authorize its guarded status update in this
-- transaction only. The ride row lock and requested/null predicates make a
-- second concurrent acceptance fail after the first claim commits.
create or replace function public.accept_ride(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := (select auth.uid()); v_ride public.rides;
begin
  if v_uid is null or not exists (
    select 1 from public.riders where user_id=v_uid and approval_status='approved' and is_online
  ) then
    raise exception 'Approved online rider required' using errcode='42501';
  end if;
  if exists (
    select 1 from public.rides
    where rider_id=v_uid and status in ('accepted','arrived','picked_up','in_progress')
  ) then
    raise exception 'You already have an active ride' using errcode='23505';
  end if;

  perform set_config('autowala.ride_transition','allowed',true);
  update public.rides r
  set rider_id=v_uid,status='accepted',accepted_at=now(),updated_at=now()
  where r.id=p_ride_id and r.status='requested' and r.rider_id is null
    and r.booking_code_expires_at>now()
    and exists (
      select 1 from public.ride_requests q
      where q.ride_id=r.id and q.rider_id=v_uid and q.status='pending'
    )
  returning r.* into v_ride;
  if not found then
    raise exception 'Ride has already been accepted or is unavailable' using errcode='23505';
  end if;
  update public.ride_requests
  set status=case when rider_id=v_uid then 'accepted'::public.ride_request_status
                  else 'expired'::public.ride_request_status end,
      responded_at=now()
  where ride_id=p_ride_id and status='pending';
  return jsonb_build_object('ride',to_jsonb(v_ride)-'booking_code_hash'-'booking_code_attempts');
end;
$$;
revoke all on function public.accept_ride(uuid) from public, anon;
grant execute on function public.accept_ride(uuid) to authenticated;

create or replace function public.mark_rider_arrived(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_ride public.rides;
begin
  perform set_config('autowala.ride_transition','allowed',true);
  update public.rides
  set status='arrived',arrived_at=now(),updated_at=now()
  where id=p_ride_id and rider_id=(select auth.uid()) and status='accepted'
  returning * into v_ride;
  if not found then
    raise exception 'Ride is not yours or is not accepted' using errcode='42501';
  end if;
  return jsonb_build_object('ride',to_jsonb(v_ride)-'booking_code_hash'-'booking_code_attempts');
end;
$$;
revoke all on function public.mark_rider_arrived(uuid) from public, anon;
grant execute on function public.mark_rider_arrived(uuid) to authenticated;

alter table public.rides add column if not exists fare_config_snapshot jsonb;

create table if not exists public.fare_settings (
  id smallint primary key default 1 check (id = 1),
  base_fare numeric(10,2) not null default 0 check (base_fare between 0 and 1000000),
  per_km_rate numeric(10,2) not null default 1 check (per_km_rate between 0 and 1000000),
  minimum_fare numeric(10,2) not null default 0 check (minimum_fare between 0 and 1000000),
  platform_fee numeric(10,2) not null default 0 check (platform_fee between 0 and 1000000),
  tax numeric(10,2) not null default 0 check (tax between 0 and 1000000),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.fare_settings(id,base_fare,per_km_rate,minimum_fare,platform_fee,tax)
values (1,0,1,0,0,0) on conflict (id) do nothing;
alter table public.fare_settings enable row level security;
revoke all on public.fare_settings from public, anon, authenticated;

create or replace function public.get_fare_config()
returns jsonb
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'base_fare',base_fare,'per_km_rate',per_km_rate,
    'minimum_fare',minimum_fare,'platform_fee',platform_fee,'tax',tax,
    'updated_at',updated_at
  ) from public.fare_settings where id=1;
$$;
revoke all on function public.get_fare_config() from public, anon;
grant execute on function public.get_fare_config() to authenticated;

create or replace function public.set_fare_config(
  p_base_fare numeric,p_per_km_rate numeric,p_minimum_fare numeric,p_platform_fee numeric,p_tax numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_settings public.fare_settings;
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  if p_base_fare is null or p_per_km_rate is null or p_minimum_fare is null
     or p_platform_fee is null or p_tax is null
     or p_base_fare not between 0 and 1000000
     or p_per_km_rate not between 0 and 1000000
     or p_minimum_fare not between 0 and 1000000
     or p_platform_fee not between 0 and 1000000
     or p_tax not between 0 and 1000000 then
    raise exception 'Fare values must be between 0 and 1000000';
  end if;
  update public.fare_settings
  set base_fare=round(p_base_fare,2), per_km_rate=round(p_per_km_rate,2),
      minimum_fare=round(p_minimum_fare,2), platform_fee=round(p_platform_fee,2),
      tax=round(p_tax,2), updated_by=(select auth.uid()), updated_at=now()
  where id=1 returning * into v_settings;
  return jsonb_build_object(
    'base_fare',v_settings.base_fare,'per_km_rate',v_settings.per_km_rate,
    'minimum_fare',v_settings.minimum_fare,'platform_fee',v_settings.platform_fee,
    'tax',v_settings.tax,'updated_at',v_settings.updated_at
  );
end;
$$;
revoke all on function public.set_fare_config(numeric,numeric,numeric,numeric,numeric) from public, anon;
grant execute on function public.set_fare_config(numeric,numeric,numeric,numeric,numeric) to authenticated;

create table if not exists public.ride_earnings (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null unique references public.rides(id) on delete restrict,
  rider_id uuid not null references public.profiles(id) on delete restrict,
  gross_fare numeric(10,2) not null check (gross_fare >= 0),
  platform_fee numeric(10,2) not null check (platform_fee >= 0),
  tax_amount numeric(10,2) not null default 0 check (tax_amount >= 0),
  rider_earning numeric(10,2) not null check (rider_earning >= 0),
  payout_status text not null default 'pending' check (payout_status in ('pending','processing','paid','failed')),
  payout_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ride_earnings add column if not exists tax_amount numeric(10,2) not null default 0 check (tax_amount >= 0);
create index if not exists ride_earnings_rider_created_idx on public.ride_earnings(rider_id,created_at desc);
alter table public.ride_earnings enable row level security;
revoke all on public.ride_earnings from public, anon;
grant select on public.ride_earnings to authenticated;
drop policy if exists ride_earnings_select_owner_or_admin on public.ride_earnings;
create policy ride_earnings_select_owner_or_admin on public.ride_earnings for select to authenticated
  using (rider_id=(select auth.uid()) or (select public.is_admin()));
drop trigger if exists ride_earnings_set_updated_at on public.ride_earnings;
create trigger ride_earnings_set_updated_at before update on public.ride_earnings
  for each row execute function public.set_updated_at();

create or replace function public.get_rider_earnings_summary()
returns jsonb
language plpgsql
stable security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := (select auth.uid()); v_summary jsonb;
begin
  if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and role='rider') then
    raise exception 'Rider authentication required' using errcode='42501';
  end if;
  select jsonb_build_object(
    'todayEarnings',coalesce(sum(rider_earning) filter(where created_at>=date_trunc('day',now())),0),
    'weekEarnings',coalesce(sum(rider_earning) filter(where created_at>=date_trunc('week',now())),0),
    'completedRides',count(*),
    'todayCompletedRides',count(*) filter(where created_at>=date_trunc('day',now())),
    'pendingPayout',coalesce(sum(rider_earning) filter(where payout_status in ('pending','failed')),0)
  ) into v_summary
  from public.ride_earnings where rider_id=v_uid;
  return v_summary;
end;
$$;
revoke all on function public.get_rider_earnings_summary() from public, anon;
grant execute on function public.get_rider_earnings_summary() to authenticated;

create or replace function public.set_ride_earning_payout_status(p_ride_id uuid,p_status text,p_reference text default null)
returns public.ride_earnings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_earning public.ride_earnings;
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  if p_status not in ('pending','processing','paid','failed') then raise exception 'Invalid payout status'; end if;
  update public.ride_earnings
  set payout_status=p_status,payout_reference=nullif(btrim(p_reference),''),updated_at=now()
  where ride_id=p_ride_id returning * into v_earning;
  if not found then raise exception 'Earning record not found'; end if;
  return v_earning;
end;
$$;
revoke all on function public.set_ride_earning_payout_status(uuid,text,text) from public, anon;
grant execute on function public.set_ride_earning_payout_status(uuid,text,text) to authenticated;

create or replace function public.get_admin_financial_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  return (
    select jsonb_build_object(
      'payments',count(*),
      'paidPayments',count(*) filter(where payment_status='paid'::public.payment_status),
      'totalPaid',coalesce(sum(amount) filter(where payment_status='paid'::public.payment_status),0),
      'pendingPaymentAmount',coalesce(sum(amount) filter(where payment_status in ('pending'::public.payment_status,'processing'::public.payment_status)),0)
    ) from public.payments
  );
end;
$$;
revoke all on function public.get_admin_financial_summary() from public, anon;
grant execute on function public.get_admin_financial_summary() to authenticated;

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
  if exists(select 1 from public.rides where passenger_id=v_uid and status in ('requested','accepted','arrived','picked_up','in_progress')) then
    raise exception 'You already have an active ride' using errcode='23505';
  end if;

  select * into strict v_config from public.fare_settings where id=1;
  v_fare := round(greatest(v_config.minimum_fare,
    v_config.base_fare + v_distance_km*v_config.per_km_rate
      + v_config.platform_fee + v_config.tax),2);
  if v_fare > 99999999.99 then raise exception 'Calculated fare exceeds the supported limit'; end if;

  -- Serialize the active-code uniqueness check across concurrent bookings.
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

create or replace function public.verify_pickup_code(p_ride_id uuid,p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_ride public.rides;
begin
  select * into v_ride from public.rides where id=p_ride_id for update;
  if not found or v_ride.rider_id is distinct from (select auth.uid()) or v_ride.status<>'arrived' then
    raise exception 'Ride is not awaiting pickup verification for this rider' using errcode='42501';
  end if;
  if v_ride.booking_code_expires_at is null or v_ride.booking_code_expires_at<now() or v_ride.booking_code_attempts>=5 then
    return jsonb_build_object('error','Pickup code expired or locked');
  end if;
  if p_code is null or p_code !~ '^\d{6}$'
     or extensions.crypt(p_code,v_ride.booking_code_hash)<>v_ride.booking_code_hash then
    update public.rides set booking_code_attempts=booking_code_attempts+1 where id=p_ride_id;
    return jsonb_build_object('error','Invalid pickup code','attempts_remaining',greatest(0,4-v_ride.booking_code_attempts));
  end if;
  perform set_config('autowala.ride_transition','allowed',true);
  update public.rides set status='picked_up',picked_up_at=now(),booking_code_hash=null,updated_at=now()
  where id=p_ride_id and rider_id=(select auth.uid()) and status='arrived'
  returning * into v_ride;
  if not found then raise exception 'Pickup verification could not be completed'; end if;
  update public.ride_passengers set status='picked_up',picked_up_at=now() where ride_id=p_ride_id and status='waiting';
  return jsonb_build_object('ride',to_jsonb(v_ride)-'booking_code_hash'-'booking_code_attempts');
end;
$$;
revoke all on function public.verify_pickup_code(uuid,text) from public, anon;
grant execute on function public.verify_pickup_code(uuid,text) to authenticated;

create or replace function public.start_ride_rpc(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_ride public.rides;
begin
  perform set_config('autowala.ride_transition','allowed',true);
  update public.rides set status='in_progress',in_progress_at=now(),updated_at=now()
  where id=p_ride_id and rider_id=(select auth.uid()) and status='picked_up'
  returning * into v_ride;
  if not found then raise exception 'Ride is not yours or has not been picked up' using errcode='42501'; end if;
  return jsonb_build_object('ride',to_jsonb(v_ride)-'booking_code_hash'-'booking_code_attempts');
end;
$$;
revoke all on function public.start_ride_rpc(uuid) from public, anon;
grant execute on function public.start_ride_rpc(uuid) to authenticated;

create or replace function public.complete_ride_rpc(p_ride_id uuid,p_final_fare numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ride public.rides;
  v_fare numeric(10,2);
  v_platform_fee numeric(10,2);
  v_tax_amount numeric(10,2);
begin
  select * into v_ride from public.rides where id=p_ride_id for update;
  if not found or v_ride.rider_id is distinct from (select auth.uid()) or v_ride.status<>'in_progress' then
    raise exception 'Ride is not yours or is not in progress' using errcode='42501';
  end if;
  v_fare:=round(coalesce(v_ride.estimated_fare,0),2);
  v_platform_fee:=least(v_fare,round(coalesce((v_ride.fare_config_snapshot->>'platform_fee')::numeric,0),2));
  v_tax_amount:=least(greatest(0,v_fare-v_platform_fee),round(coalesce((v_ride.fare_config_snapshot->>'tax')::numeric,0),2));
  perform set_config('autowala.ride_transition','allowed',true);
  update public.rides set status='completed',completed_at=now(),final_fare=v_fare,updated_at=now()
  where id=p_ride_id and rider_id=(select auth.uid()) and status='in_progress'
  returning * into v_ride;
  if not found then raise exception 'Ride could not be completed'; end if;
  insert into public.ride_earnings(ride_id,rider_id,gross_fare,platform_fee,tax_amount,rider_earning)
  values(p_ride_id,v_ride.rider_id,v_fare,v_platform_fee,v_tax_amount,greatest(0,v_fare-v_platform_fee-v_tax_amount))
  on conflict(ride_id) do nothing;
  update public.ride_passengers set status='completed',completed_at=now()
  where ride_id=p_ride_id and status='picked_up';
  return jsonb_build_object('ride',to_jsonb(v_ride)-'booking_code_hash'-'booking_code_attempts');
end;
$$;
revoke all on function public.complete_ride_rpc(uuid,numeric) from public, anon;
grant execute on function public.complete_ride_rpc(uuid,numeric) to authenticated;

create or replace function public.cancel_ride_rpc(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_ride public.rides; v_uid uuid:=(select auth.uid());
begin
  if v_uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform set_config('autowala.ride_transition','allowed',true);
  update public.rides set status='cancelled',cancelled_at=now(),updated_at=now()
  where id=p_ride_id and (
    (passenger_id=v_uid and status in ('requested','accepted','arrived'))
    or (rider_id=v_uid and status in ('accepted','arrived'))
  ) returning * into v_ride;
  if not found then raise exception 'Ride is not yours or can no longer be cancelled' using errcode='42501'; end if;
  update public.ride_requests set status='cancelled',responded_at=now()
  where ride_id=p_ride_id and status in ('pending','accepted');
  return jsonb_build_object('ride',to_jsonb(v_ride)-'booking_code_hash'-'booking_code_attempts');
end;
$$;
revoke all on function public.cancel_ride_rpc(uuid) from public, anon;
grant execute on function public.cancel_ride_rpc(uuid) to authenticated;

-- Rebuild the notification enum after the old values have been migrated.
alter type public.notification_kind rename to notification_kind_legacy;
create type public.notification_kind as enum (
  'ride_request','ride_accepted','rider_arrived','passenger_picked_up',
  'ride_in_progress','ride_completed','ride_cancelled','payment_status','rider_approval'
);
alter table public.notifications alter column kind type public.notification_kind
using (
  case kind::text
    when 'rider_arriving' then 'rider_arrived'
    when 'ride_started' then 'ride_in_progress'
    else kind::text
  end
)::public.notification_kind;
drop type public.notification_kind_legacy;

notify pgrst, 'reload schema';
commit;
