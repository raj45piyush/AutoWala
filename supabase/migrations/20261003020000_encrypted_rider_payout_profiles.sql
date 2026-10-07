begin;

create table if not exists public.rider_payout_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  encrypted_payload text not null,
  payout_method text not null check (payout_method in ('bank','upi')),
  account_last4 text,
  updated_at timestamptz not null default now()
);
alter table public.rider_payout_profiles enable row level security;
revoke all on public.rider_payout_profiles from public, anon, authenticated;
comment on table public.rider_payout_profiles is
  'Encrypted payout instructions managed only by the server using RIDER_PAYOUT_ENCRYPTION_KEY.';

commit;
