-- Billing: entries the operator says don't count toward a promoter's bill —
-- people Club Fuoco brought in itself, comps, staff, tests.
--
-- Two shapes, one table:
--   * a whole PERSON  (user_id set)            → none of their entries count
--   * ONE ENTRY       (source + line_id set)   → just that guestlist/purchase
--
-- Service-role only (the portal); RLS on with no policies so the anon and
-- authenticated keys can neither read nor write it.

create table if not exists public.billing_exclusions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,
  source     text check (source in ('offer', 'event', 'fourvenues')),
  line_id    uuid,
  reason     text,
  created_at timestamptz not null default now(),
  constraint billing_exclusions_shape check (
    (user_id is not null and source is null and line_id is null)
    or (user_id is null and source is not null and line_id is not null)
  )
);

create unique index if not exists billing_exclusions_user_uniq
  on public.billing_exclusions (user_id) where user_id is not null;
create unique index if not exists billing_exclusions_line_uniq
  on public.billing_exclusions (source, line_id) where line_id is not null;

alter table public.billing_exclusions enable row level security;
