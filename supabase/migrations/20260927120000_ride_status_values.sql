-- Add the canonical values in an isolated migration so PostgreSQL commits
-- them before later migrations define policies and RPCs that use them.
do $enum$
begin
  if to_regtype('public.ride_status') is not null then
    if not exists (select 1 from pg_enum where enumtypid='public.ride_status'::regtype and enumlabel='requested') then alter type public.ride_status add value 'requested'; end if;
    if not exists (select 1 from pg_enum where enumtypid='public.ride_status'::regtype and enumlabel='accepted') then alter type public.ride_status add value 'accepted'; end if;
    if not exists (select 1 from pg_enum where enumtypid='public.ride_status'::regtype and enumlabel='arrived') then alter type public.ride_status add value 'arrived'; end if;
    if not exists (select 1 from pg_enum where enumtypid='public.ride_status'::regtype and enumlabel='picked_up') then alter type public.ride_status add value 'picked_up'; end if;
    if not exists (select 1 from pg_enum where enumtypid='public.ride_status'::regtype and enumlabel='in_progress') then alter type public.ride_status add value 'in_progress'; end if;
    if not exists (select 1 from pg_enum where enumtypid='public.ride_status'::regtype and enumlabel='completed') then alter type public.ride_status add value 'completed'; end if;
    if not exists (select 1 from pg_enum where enumtypid='public.ride_status'::regtype and enumlabel='cancelled') then alter type public.ride_status add value 'cancelled'; end if;
  end if;
end;
$enum$;
