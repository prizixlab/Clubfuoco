-- Supplier login email: the address a supplier/list (Rumba, Aashi, …) uses to
-- sign in to the FuocoPromoters app (email-OTP) to monitor their own offers.
-- Visible + amendable on the company Partner Portal side. Nullable — a brand
-- may exist before its login is provisioned.
-- Run in the SQL editor (production drifts from local DDL — apply manually).

alter table public.partner_brands
  add column if not exists login_email text;
