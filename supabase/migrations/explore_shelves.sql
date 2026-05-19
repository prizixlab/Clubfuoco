-- Custom Explore shelves — admin-managed rows that sit alongside the
-- default algorithmic shelves on the Explore feed.
--
-- A shelf is either:
--   • 'auto'   — filled by a rule (filter + sort), evaluated client-side
--                against the live venue feed.
--   • 'manual' — filled with a specific, ordered list of venues (place_ids,
--                which are clubs.id values).
--
-- `position` controls where the shelf is inserted among the default rows:
-- 1 = near the top, larger = further down. The default rows always remain.
--
-- Run this in the Supabase SQL editor.

create table if not exists explore_shelves (
  id          uuid primary key default gen_random_uuid(),
  title       text        not null,
  subtitle    text        not null default '',
  mode        text        not null default 'auto'  check (mode in ('auto','manual')),
  -- auto-mode rule
  auto_filter text        not null default 'all'   check (auto_filter in ('all','open','partner','featured','genre')),
  auto_genre  text,
  auto_sort   text        not null default 'rating' check (auto_sort in ('rating','popular','random')),
  -- manual-mode picks: ordered clubs.id values
  place_ids   text[]      not null default '{}',
  position    int         not null default 3,
  enabled     boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists explore_shelves_enabled_idx on explore_shelves (enabled, position);

-- RLS is on; all access goes through API routes using the service role,
-- so no public policies are needed.
alter table explore_shelves enable row level security;
