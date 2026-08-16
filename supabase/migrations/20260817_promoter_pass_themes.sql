-- Promoter-branded Apple Wallet passes.
--
-- The theme a promoter applies to the pass their guests receive. Deliberately
-- NOT folded into either existing identity record:
--   promoter_profiles  has brand_name + logo_url but no colour
--   partner_brands     has a colour, but /api/offers/me refuses to let a
--                      promoter edit it — it is part of the brand contract an
--                      operator sets in the portal.
-- A pass theme also carries things neither table should hold: rendered image
-- derivatives at fixed pixel sizes, and a moderation status.
--
-- Defaults are exactly the values that were hardcoded in
-- /api/promoter-invites/guest/[guestId]/wallet, so a promoter who never opens
-- the screen keeps precisely today's pass.

create table if not exists public.promoter_pass_themes (
  -- public.users, matching promoter_profiles rather than auth.users: the same
  -- accounts that can already save a promoter profile can save a theme.
  user_id      uuid primary key references public.users(id) on delete cascade,

  -- Chosen by the promoter. Only two: the value colour is derived, because
  -- there is exactly one legible answer for a given background and letting
  -- someone pick it only lets them pick wrong. See src/lib/wallet/contrast.ts.
  background   text not null default '#0A0807',
  accent       text not null default '#E8B65B',

  -- Used as the wordmark only when no logo image is set.
  logo_text    text,

  -- Written by the server only, never by the client: these are the exact
  -- bitmaps that go inside a bundle we sign with our Pass Type ID certificate.
  logo_1x_url  text,
  logo_2x_url  text,
  logo_3x_url  text,
  icon_1x_url  text,
  icon_2x_url  text,
  icon_3x_url  text,

  -- A blocked theme falls back to the house palette rather than failing pass
  -- generation: whatever a review decides, the door has to keep working.
  status       text not null default 'active'
               check (status in ('active', 'under_review', 'blocked')),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.promoter_pass_themes is
  'Per-promoter branding for the Apple Wallet pass their guests receive. Colours are stored as #RRGGBB; the pass foreground colour is derived at render time.';

alter table public.promoter_pass_themes enable row level security;

-- Read your own theme. There is deliberately no write policy: every write goes
-- through /api/promoter/pass-theme on the service role, so a promoter can
-- never store an unvalidated colour pair, nor point a derived image URL at
-- something we did not render ourselves.
drop policy if exists "own pass theme read" on public.promoter_pass_themes;
create policy "own pass theme read" on public.promoter_pass_themes
  for select using (user_id = auth.uid());

create or replace function public.touch_promoter_pass_theme()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists promoter_pass_themes_touch on public.promoter_pass_themes;
create trigger promoter_pass_themes_touch
  before update on public.promoter_pass_themes
  for each row execute function public.touch_promoter_pass_theme();
