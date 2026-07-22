-- Per-venue control over WHICH suppliers' offers reach the app.
--
-- NOT APPLIED — run in the SQL editor.
--
-- Several suppliers can cover the same venue (Rumba and Aashi both do Opium),
-- and the operator decides per venue who is shown. Deliberately not a binary
-- winner: `selected` holds a set, so a venue can surface two suppliers out of
-- five when the roster grows.
--
--   no row / 'all'  every visible supplier's offers show (default — a new
--                   supplier never silently disappears)
--   'none'          no offers from any supplier at this venue
--   'selected'      only suppliers listed in brand_ids
--
-- Independent of partner_brands.offers_hidden, which mutes ONE supplier
-- everywhere. Both gates apply: a hidden supplier stays hidden even if a venue
-- rule selects them.

create table if not exists public.club_offer_visibility (
  club_id    uuid primary key references public.clubs(id) on delete cascade,
  mode       text not null default 'all' check (mode in ('all', 'none', 'selected')),
  -- Meaningful only when mode = 'selected'. Not a FK array (Postgres can't),
  -- so a deleted brand simply stops matching — it can never resurrect offers.
  brand_ids  uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

comment on table public.club_offer_visibility is
  'Operator rule for which suppliers may show offers at a venue. Absent row = all.';

alter table public.club_offer_visibility enable row level security;

-- Read-only to clients; the portal writes with the service role, which
-- bypasses RLS. Without this, Supabase default grants would let the anon key
-- rewrite these rules.
drop policy if exists "offer visibility is publicly readable" on public.club_offer_visibility;
create policy "offer visibility is publicly readable"
  on public.club_offer_visibility for select
  to anon, authenticated
  using (true);
