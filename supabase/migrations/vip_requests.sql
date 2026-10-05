-- VIP tables, stage one — scoped to the rooms Rumbalist already operates in.
--
-- A VIP table is not a purchase, it is an application: the guest asks for a
-- zone on a given night, the club approves or declines, and only then does
-- money settle. `bookings.status` has no word for "asked but not yet accepted",
-- so the request lives in its own table until a club actually confirms it.
--
-- Nothing here talks to a booking engine. Of the eight rooms Rumbalist has sent
-- guests to, exactly two sell tables through an API we could call (Opium and Ku,
-- both Fourvenues) and we hold no channel key for either. The other table-selling
-- rooms take reservations on a phone. So stage one captures the request properly
-- and routes it by hand; the engine column is what stage two switches on.

-- ── Where each club's VIP tables are actually sold ────────────────────────────
-- One row per club, so a club's booking engine is data rather than a branch in
-- code. Same swappable-supplier shape the Partner Portal already uses.
CREATE TABLE IF NOT EXISTS club_vip_sources (
  club_id         uuid PRIMARY KEY REFERENCES clubs(id) ON DELETE CASCADE,
  -- How tables are sold, NOT how tickets are sold. Several of these clubs sell
  -- tickets through Fourvenues or Xceed while taking tables on WhatsApp; the
  -- ticket engine on the home page is not evidence about tables.
  engine          text NOT NULL
                  CHECK (engine IN ('fourvenues','notikumi','covermanager','whatsapp','email','phone','none')),
  -- 'A' integrable today, 'B' engine unverified, 'C' relayed by a human,
  -- 'N' the room does not sell tables at all.
  tier            char(1) NOT NULL CHECK (tier IN ('A','B','C','N')),
  sells_tables    boolean NOT NULL DEFAULT true,
  external_org_slug text,           -- e.g. 'ku-barcelona' on Fourvenues
  external_org_id   text,           -- filled from GET /organizations once keyed
  -- Where a stage-one request gets relayed. Never rendered to the guest: it is
  -- ours to action, not theirs to contact around us.
  relay_channel   text CHECK (relay_channel IN ('whatsapp','email','phone')),
  relay_target    text,
  relay_contact   text,             -- named person at the venue, when there is one
  vip_page_url    text,
  zones_count     int,
  verified_at     timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE club_vip_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vip sources public read" ON club_vip_sources;
-- Readable so the app can show "tables available here" — but the relay columns
-- carry venue phone numbers, so the app must select explicit columns, never *.
CREATE POLICY "vip sources public read" ON club_vip_sources
  FOR SELECT USING (true);
-- No user write policy: writes are service-role only.

-- ── Published zone pricing, where the club states it publicly ─────────────────
-- Twenties prints its whole table of zones and minimum spends on its VIP page.
-- Caching that lets the app quote a real price on night one instead of the
-- uselessly vague "from €400". Not availability — this is a price list, and it
-- says nothing about whether a table is free on a given date.
CREATE TABLE IF NOT EXISTS club_vip_zones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id         uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name            text NOT NULL,
  slug            text NOT NULL,
  min_spend_cents int  NOT NULL CHECK (min_spend_cents >= 0),
  included_pax    int  CHECK (included_pax > 0),
  sort_order      int  NOT NULL DEFAULT 0,
  source          text NOT NULL DEFAULT 'published'
                  CHECK (source IN ('published','api','quoted')),
  source_url      text,
  captured_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_id, slug)
);

ALTER TABLE club_vip_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vip zones public read" ON club_vip_zones;
CREATE POLICY "vip zones public read" ON club_vip_zones FOR SELECT USING (true);

-- ── The request itself ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vip_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  club_id           uuid NOT NULL REFERENCES clubs(id) ON DELETE RESTRICT,
  promoter_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  event_date        date NOT NULL,
  party_size        int  NOT NULL CHECK (party_size BETWEEN 1 AND 40),
  zone_id           uuid REFERENCES club_vip_zones(id) ON DELETE SET NULL,
  zone_preference   text,
  -- What the guest is willing to spend, in cents. Asking for a band up front is
  -- what makes the relay short: the venue can answer yes or no in one message.
  budget_min_cents  int CHECK (budget_min_cents >= 0),
  budget_max_cents  int CHECK (budget_max_cents >= 0),
  occasion          text,
  notes             text,
  contact_phone     text NOT NULL,

  status            text NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested','relayed','confirmed','declined','expired','cancelled')),
  -- Set when we hand it to the venue, so an unrelayed request is visibly ours
  -- to chase rather than silently sitting in a queue.
  relayed_at        timestamptz,
  relayed_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  responded_at      timestamptz,
  club_reference    text,            -- the venue's own booking ref, once given
  quoted_total_cents int CHECK (quoted_total_cents >= 0),
  decline_reason    text,
  -- Present only once a real engine confirms it; stage one leaves it null.
  booking_id        uuid REFERENCES bookings(id) ON DELETE SET NULL,
  external_booking_id text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vip_budget_ordered
    CHECK (budget_min_cents IS NULL OR budget_max_cents IS NULL
           OR budget_min_cents <= budget_max_cents)
);

ALTER TABLE vip_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own vip requests read" ON vip_requests;
CREATE POLICY "own vip requests read" ON vip_requests
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "own vip requests insert" ON vip_requests;
CREATE POLICY "own vip requests insert" ON vip_requests
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Cancelling is the only edit a guest may make, and only before we have relayed
-- it. Every other transition is service-role, because it asserts something about
-- what a venue said.
--
-- The USING/WITH CHECK pair is deliberate and load-bearing: without WITH CHECK a
-- guest could flip their own row to 'confirmed'. See the RLS orphan bug where
-- user writes silently updated zero rows — both halves are required here.
DROP POLICY IF EXISTS "own vip requests cancel" ON vip_requests;
CREATE POLICY "own vip requests cancel" ON vip_requests
  FOR UPDATE
  USING  (user_id = auth.uid() AND status = 'requested')
  WITH CHECK (user_id = auth.uid() AND status IN ('requested','cancelled'));

CREATE INDEX IF NOT EXISTS idx_vip_requests_open
  ON vip_requests(created_at) WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS idx_vip_requests_user
  ON vip_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vip_requests_club_date
  ON vip_requests(club_id, event_date);

-- ── Seed: the eight rooms Rumbalist has actually sent guests to ───────────────
-- Verified 30 Aug 2026 by loading each club's own VIP page, not by fingerprinting
-- its home page — that overcounts, because a club's ticket engine and its table
-- channel are usually different vendors.
INSERT INTO club_vip_sources
  (club_id, engine, tier, sells_tables, external_org_slug, relay_channel, relay_target, relay_contact, vip_page_url, zones_count, verified_at, notes)
VALUES
  -- Fourvenues, confirmed by a live call to api.fourvenues.com from the club's
  -- own calendar page. Advertises seven VIP zones.
  ('b3f7747f-d911-490d-a688-d04add6a1c8b','fourvenues','A',true,NULL,'email','reservas@opiumbarcelona.com',NULL,
   'https://opiumbarcelona.com/vip/',7,now(),
   'Fourvenues confirmed at /calendario/. Org slug pending GET /organizations. CoverManager on site is the restaurant only.'),

  -- Fourvenues, and the only room whose org slug we can already read: the club
  -- embeds fourvenues.com/iframe/ku-barcelona/calendar directly.
  ('d184f2f1-8db3-4d03-ae11-ad19b650894d','fourvenues','A',true,'ku-barcelona','email',NULL,NULL,
   'https://www.kubarcelona.com/',NULL,now(),
   'Org slug ku-barcelona read from the embedded calendar iframe. Also listed as "Pacha Barcelona" in rumbalist_purchases — same room, same id.'),

  -- Notikumi sells the tickets; the "Mesas VIP" button is a WhatsApp link.
  ('ddca5d10-9b4f-47c4-81a2-2c36bef77e49','whatsapp','C',true,NULL,'whatsapp','+34663701082',NULL,
   'https://shoko.biz/',NULL,now(),
   'Tables are wa.me/34663701082. Notikumi covers ticketing only — do not assume a table API.'),

  -- A dedicated VIP desk, separate from the restaurant line.
  ('d649395c-d3db-4397-b200-42b575d1738a','email','C',true,NULL,'email','vipservice@cdlcbarcelona.com',NULL,
   'https://cdlcbarcelona.com/sales/',NULL,now(),
   'VIP desk vipservice@cdlcbarcelona.com / +34 647 779 999. The CoverManager widget on /reservas/ is restaurant covers, not tables.'),

  -- Publishes its whole zone price list, and books through one named person.
  ('3c3716e0-0361-4a62-b4d2-ec1eb5d00bbb','phone','C',true,NULL,'phone','+34611251592','Jordi',
   'https://twentiesbarcelona.com/vip-experience/',6,now(),
   'Six zones with public minimum spends, seeded into club_vip_zones. Fourvenues on this site is tickets only.'),

  -- Rooms Rumbalist sends guests to that have no table product at all. Recorded
  -- so nobody re-investigates them, and so the app never offers a table here.
  ('bdafd62c-2543-4238-9951-e4a1a17bb7eb','none','N',false,NULL,NULL,NULL,NULL,
   'https://cityhallbarcelona.com/',NULL,now(),
   'Techno room, Xceed ticketing, no VIP table product advertised.'),
  ('acfe5fb3-707b-4dde-8ca7-95a416a415a2','none','N',false,NULL,NULL,NULL,NULL,
   'https://www.ovellanegra.com/',NULL,now(),
   'Rock bar. No table service.'),
  ('a83428e5-5c7f-4f55-99e5-3f329f7c3210','none','N',false,NULL,NULL,NULL,NULL,
   'https://www.jamboreejazz.com/',NULL,now(),
   'Jazz cellar. Seated shows, no VIP tables.')
ON CONFLICT (club_id) DO UPDATE SET
  engine            = EXCLUDED.engine,
  tier              = EXCLUDED.tier,
  sells_tables      = EXCLUDED.sells_tables,
  external_org_slug = EXCLUDED.external_org_slug,
  relay_channel     = EXCLUDED.relay_channel,
  relay_target      = EXCLUDED.relay_target,
  relay_contact     = EXCLUDED.relay_contact,
  vip_page_url      = EXCLUDED.vip_page_url,
  zones_count       = EXCLUDED.zones_count,
  verified_at       = EXCLUDED.verified_at,
  notes             = EXCLUDED.notes,
  updated_at        = now();

-- Twenties' published zones, transcribed from its own VIP page.
INSERT INTO club_vip_zones (club_id, name, slug, min_spend_cents, included_pax, sort_order, source, source_url)
VALUES
  ('3c3716e0-0361-4a62-b4d2-ec1eb5d00bbb','Yellow','yellow',              30000, 5,1,'published','https://twentiesbarcelona.com/vip-experience/'),
  ('3c3716e0-0361-4a62-b4d2-ec1eb5d00bbb','Orange','orange',              35000, 5,2,'published','https://twentiesbarcelona.com/vip-experience/'),
  ('3c3716e0-0361-4a62-b4d2-ec1eb5d00bbb','Red','red',                    50000, 7,3,'published','https://twentiesbarcelona.com/vip-experience/'),
  ('3c3716e0-0361-4a62-b4d2-ec1eb5d00bbb','Pink','pink',                  60000, 8,4,'published','https://twentiesbarcelona.com/vip-experience/'),
  ('3c3716e0-0361-4a62-b4d2-ec1eb5d00bbb','Blue · Backstage','blue',     150000,10,5,'published','https://twentiesbarcelona.com/vip-experience/'),
  ('3c3716e0-0361-4a62-b4d2-ec1eb5d00bbb','Tiffany Blue · Backstage','tiffany-blue',250000,12,6,'published','https://twentiesbarcelona.com/vip-experience/')
ON CONFLICT (club_id, slug) DO UPDATE SET
  name            = EXCLUDED.name,
  min_spend_cents = EXCLUDED.min_spend_cents,
  included_pax    = EXCLUDED.included_pax,
  sort_order      = EXCLUDED.sort_order,
  captured_at     = now();
