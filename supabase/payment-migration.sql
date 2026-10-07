-- Non-destructive migration for an AutoWala database that already ran the
-- earlier schema. This only adds/backfills payment columns and tightens RLS.
-- Do not run this instead of schema.sql on a brand-new database.

begin;

alter table public.payments add column if not exists user_id uuid;
alter table public.payments add column if not exists payment_status public.payment_status;
alter table public.payments add column if not exists razorpay_order_id text;
alter table public.payments add column if not exists razorpay_payment_id text;
alter table public.payments add column if not exists transaction_reference text;

update public.payments
set user_id = coalesce(user_id, payer_id),
    payment_status = coalesce(payment_status, status),
    transaction_reference = coalesce(transaction_reference, provider_payment_id)
where user_id is null
   or payment_status is null
   or transaction_reference is null;

alter table public.payments alter column user_id set not null;
alter table public.payments alter column payment_status set default 'pending'::public.payment_status;
alter table public.payments alter column payment_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_user_id_fkey'
  ) then
    alter table public.payments
      add constraint payments_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_status_columns_match'
  ) then
    alter table public.payments
      add constraint payments_status_columns_match check (status = payment_status);
  end if;
end;
$$;

create unique index if not exists payments_razorpay_order_idx
on public.payments(razorpay_order_id)
where razorpay_order_id is not null;

create unique index if not exists payments_razorpay_payment_idx
on public.payments(razorpay_payment_id)
where razorpay_payment_id is not null;

create or replace function public.sync_payment_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.user_id := coalesce(new.user_id, new.payer_id);
  new.payer_id := coalesce(new.payer_id, new.user_id);
  new.payment_status := coalesce(new.payment_status, new.status, 'pending'::public.payment_status);
  new.status := new.payment_status;
  new.transaction_reference := coalesce(new.transaction_reference, new.provider_payment_id);
  new.provider_payment_id := coalesce(new.provider_payment_id, new.transaction_reference);
  return new;
end;
$$;

drop trigger if exists payments_sync_columns on public.payments;
create trigger payments_sync_columns
before insert or update on public.payments
for each row execute function public.sync_payment_columns();

alter table public.payments enable row level security;

drop policy if exists payments_select_participant_or_admin on public.payments;
create policy payments_select_participant_or_admin
on public.payments for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.rides r
    where r.id = payments.ride_id and r.rider_id = (select auth.uid())
  )
  or (select public.is_admin())
);

drop policy if exists payments_insert_payer on public.payments;
create policy payments_insert_payer
on public.payments for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and payment_status = 'pending'::public.payment_status
  and exists (
    select 1 from public.rides r
    where r.id = payments.ride_id and r.passenger_id = (select auth.uid())
  )
);

drop policy if exists payments_admin_update on public.payments;
create policy payments_admin_update
on public.payments for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

commit;
