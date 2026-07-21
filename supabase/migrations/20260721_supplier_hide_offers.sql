-- Supplier-level "hide all offers" switch for the Partner Portal.
--
-- Temporarily removes every offer from one supplier from the public feed
-- WITHOUT touching the offer rows: each offer keeps its own is_active, its
-- sort_order and its skipped_dates, so unhiding restores the exact prior state.
--
-- Why a new column instead of partner_brands.is_active: is_active marks the
-- PRIMARY/featured supplier (getActiveBrand, one-active partial unique index),
-- not visibility. Auto-provisioned promoter brands are deliberately
-- is_active = false and their offers must still show. Gating visibility on it
-- would hide every promoter's approved offers and break the feed.
--
-- Run in the Supabase SQL editor (production drifts — applied by hand).

alter table public.partner_brands
  add column if not exists offers_hidden boolean not null default false;

comment on column public.partner_brands.offers_hidden is
  'Operator kill-switch: when true this supplier''s offers are hidden from the '
  'public feed and refused by the booking gate. Offer rows are untouched.';

-- Partial index: the read path only ever asks "which brands are hidden", and
-- the hidden set is expected to be tiny.
create index if not exists partner_brands_offers_hidden_idx
  on public.partner_brands (id) where offers_hidden;
