-- Events cache table — populated by /api/admin/sync-events cron job
-- Stores upcoming Barcelona events fetched from Eventbrite

CREATE TABLE IF NOT EXISTS ra_events (
  id            text        PRIMARY KEY,  -- e.g. "eb_12345678"
  platform      text        NOT NULL,     -- 'eventbrite'
  title         text        NOT NULL,
  venue_name    text        NOT NULL,
  event_date    timestamptz NOT NULL,     -- used for ordering
  date          text        NOT NULL,     -- local date string from API
  start_time    text,
  image         text,
  base_price    integer     NOT NULL DEFAULT 0,   -- cents
  display_price integer     NOT NULL DEFAULT 0,   -- cents after markup
  currency      text        NOT NULL DEFAULT 'EUR',
  platform_url  text        NOT NULL,
  sold_out      boolean     NOT NULL DEFAULT false,
  venue_matched boolean     NOT NULL DEFAULT false,
  synced_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ra_events_date ON ra_events (event_date ASC);

-- No RLS needed — read by anon client, written by service role via cron
