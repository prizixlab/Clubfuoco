-- ============================================================
-- Apple In-App Purchase support for memberships
-- ------------------------------------------------------------
-- iOS memberships are now sold through Apple StoreKit (guideline 3.1.1).
-- This migration extends public.memberships to track Apple subscriptions
-- alongside the existing (legacy) Stripe columns.
-- ============================================================

-- The original CHECK only allowed gold/sapphire — add 'black'.
alter table public.memberships
  drop constraint if exists memberships_tier_check;
alter table public.memberships
  add constraint memberships_tier_check
  check (tier in ('gold', 'sapphire', 'black'));

-- Payment provider for this membership row.
alter table public.memberships
  add column if not exists provider text not null default 'apple'
    check (provider in ('apple', 'stripe'));

-- Apple StoreKit identifiers.
-- originalTransactionId is the stable key Apple uses across all renewals,
-- so webhook notifications (which have no user context) can find the user.
alter table public.memberships
  add column if not exists apple_original_transaction_id text;
alter table public.memberships
  add column if not exists apple_product_id text;

-- End of the current paid period (from the StoreKit transaction's expiresDate).
alter table public.memberships
  add column if not exists current_period_end timestamptz;

create index if not exists memberships_apple_original_tx_idx
  on public.memberships (apple_original_transaction_id);
