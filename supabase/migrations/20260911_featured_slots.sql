-- The Featured desk: one editorial list deciding what leads Explore.
--
-- NOT APPLIED — run in the SQL editor.
--
-- Until now "featured" meant three unrelated things: a venue ShelfBuilder
-- happened to tier-0 on the client, a promoter's paid `promoter_nights.featured`
-- flag, and an editorial `pinned_at` on an event. None of them was a single
-- place to answer "what leads the app tonight", and a venue could not be chosen
-- at all. This table is that place.
--
--   tier 1 — the big hero card at the head of the featured shelf
--   tier 2 — the line of smaller cards under it
--
-- Events and venues are eligible for either tier, so the slot is polymorphic:
-- exactly one of night_id / club_id is set, enforced below. A scraped RA
-- listing is deliberately NOT featurable yet — it has no consumer detail page
-- to open, so featuring one would put a dead card at the top of the feed.

create table if not exists public.featured_slots (
  id         uuid primary key default gen_random_uuid(),
  tier       smallint not null check (tier in (1, 2)),
  -- Order within the tier, lowest first. Ties break on created_at.
  rank       int not null default 0,
  night_id   uuid references public.promoter_nights(id) on delete cascade,
  club_id    uuid references public.clubs(id)           on delete cascade,
  -- Why this is up there, for whoever looks at the desk next week.
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Exactly one target. A slot pointing at both, or at neither, has no
  -- meaning — this is what makes the polymorphism safe to read.
  constraint featured_slot_one_target check (
    (night_id is not null and club_id is null) or
    (night_id is null and club_id is not null)
  )
);

-- The same night or venue must not occupy two slots: two cards for one thing
-- in the same shelf reads as a bug, and across tiers it is ambiguous which
-- wins. Partial uniques because each column is null on the other kind.
create unique index if not exists featured_slots_night_uniq
  on public.featured_slots (night_id) where night_id is not null;
create unique index if not exists featured_slots_club_uniq
  on public.featured_slots (club_id) where club_id is not null;

create index if not exists featured_slots_tier_rank_idx
  on public.featured_slots (tier, rank, created_at);

-- Read by the consumer feed through the service client, exactly like
-- v_events_feed. No public policy: RLS on, nothing granted to anon.
alter table public.featured_slots enable row level security;

comment on table public.featured_slots is
  'Editorial featured shelf. tier 1 = hero card, tier 2 = the row beneath. Exactly one of night_id/club_id per slot. Managed from /portal/featured.';
