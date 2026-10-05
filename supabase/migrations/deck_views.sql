-- Who opens the investor deck, when, and from where.
--
-- /deck is the stable link sent in cold outreach, so it's the only place we
-- learn whether a fund actually read the thing. Rows are written by the /deck
-- route on every fetch.
--
-- WHAT IS DELIBERATELY NOT STORED: the raw IP. `ip_hash` is an HMAC keyed on a
-- server secret, which is enough to tell two visits apart without holding
-- personal data on EU investors. Geo is the coarse city/country Vercel derives
-- at the edge, never coordinates.

create table if not exists public.deck_views (
  id           uuid primary key default gen_random_uuid(),
  viewed_at    timestamptz not null default now(),

  -- ?i=<tag> from the outreach link: which email this open came from.
  -- Null = someone reached /deck without a tagged link.
  recipient    text,

  -- Coarse geo from Vercel's edge headers. Null off-Vercel (local dev).
  country      text,
  region       text,
  city         text,
  timezone     text,

  referrer     text,
  user_agent   text,

  -- HMAC of the client IP. Distinguishes visitors; not reversible to an IP.
  ip_hash      text,

  -- Link unfurlers (Slack, LinkedIn, WhatsApp, Gmail) fetch the URL the moment
  -- you send it. Those rows are kept for debugging but excluded from counts.
  is_bot       boolean not null default false
);

create index if not exists idx_deck_views_viewed_at on public.deck_views (viewed_at desc);
create index if not exists idx_deck_views_recipient on public.deck_views (recipient, viewed_at desc);
create index if not exists idx_deck_views_human     on public.deck_views (viewed_at desc) where not is_bot;

-- Service role only: the route writes with the service key, and nothing else
-- should touch this table. No policies = no access for anon/authenticated.
alter table public.deck_views enable row level security;

-- ---------------------------------------------------------------------------
-- Reading it back.
--
-- Raw rows over-count: a PDF viewer issues several Range requests for one
-- open, and a reload is not a new read. This view collapses everything from
-- one visitor within a 30-minute window into a single session, which is the
-- number worth quoting.
-- ---------------------------------------------------------------------------
create or replace view public.deck_view_sessions as
with marked as (
  select
    *,
    case
      when lag(viewed_at) over w is null
        or viewed_at - lag(viewed_at) over w > interval '30 minutes'
      then 1 else 0
    end as is_new_session
  from public.deck_views
  where not is_bot
  window w as (partition by coalesce(ip_hash, 'unknown'), coalesce(recipient, '') order by viewed_at)
),
sessions as (
  select
    *,
    sum(is_new_session) over (
      partition by coalesce(ip_hash, 'unknown'), coalesce(recipient, '')
      order by viewed_at
      rows unbounded preceding
    ) as session_no
  from marked
)
select
  coalesce(recipient, '(untagged)') as recipient,
  min(viewed_at)                    as first_seen,
  max(viewed_at)                    as last_seen,
  count(*)                          as requests,
  min(country)                      as country,
  min(region)                       as region,
  min(city)                         as city,
  min(referrer)                     as referrer,
  ip_hash
from sessions
group by ip_hash, coalesce(recipient, ''), session_no, recipient
order by first_seen desc;

-- Handy queries (paste into the Supabase SQL editor):
--
--   -- Total real opens
--   select count(*) from public.deck_view_sessions;
--
--   -- Who opened it, most recent first
--   select recipient, city, country, first_seen, requests
--   from public.deck_view_sessions;
--
--   -- Opens per recipient, and whether they came back
--   select recipient, count(*) as opens, max(last_seen) as most_recent
--   from public.deck_view_sessions
--   group by recipient order by opens desc;
--
--   -- Where from
--   select country, city, count(*) as opens
--   from public.deck_view_sessions
--   group by country, city order by opens desc;
--
--   -- Bot/unfurl traffic we filtered out
--   select user_agent, count(*) from public.deck_views
--   where is_bot group by user_agent order by count desc;
