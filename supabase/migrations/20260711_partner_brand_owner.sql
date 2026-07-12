-- Supplier self-service: link a partner_brand to the Supabase account that
-- signs in to the FuocoPromoters app to manage that brand's offers. The
-- account is a pre-approved promoter (account_kind='promoter', is_promoter=true)
-- provisioned from the company Partner Portal against the brand's login_email.
-- on delete set null: deleting the user unlinks, never cascades away the brand.
-- Run in the SQL editor (production drifts from local DDL — apply manually).

alter table public.partner_brands
  add column if not exists owner_user_id uuid references public.users(id) on delete set null;

create index if not exists partner_brands_owner_idx
  on public.partner_brands(owner_user_id);
