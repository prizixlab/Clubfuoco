-- 20261002_promoter_nights_fourvenues.sql
--
-- Ties a promoter's night to the Fourvenues event it is sold through, so a
-- promoter selling on Fourvenues (HypeList) keeps ONE calendar: their normal
-- `promoter_nights`, kept current hourly by agentbox (fourvenues_nights.py)
-- from the same feed the app sells from.
--
--   fourvenues_code  Fourvenues' 4-character event code ("LNKO"). The stable
--                    key: titles change ("HYPE x SOMFESTES | MASIA" became
--                    "... | MASIA EVENTS"), the code does not. Bookings made
--                    through the app (external_tickets.event_code) join on it.
--   fourvenues       Snapshot of the night's ways in as the feed last saw
--                    them — guestlists, door, tickets, table zones with their
--                    rates. Kept after the night leaves the feed, so the
--                    portal can still show what was on sale.
--
-- Both nullable: nights a promoter creates themselves never have them.
-- Idempotent — safe to paste twice.

alter table public.promoter_nights add column if not exists fourvenues_code text;
alter table public.promoter_nights add column if not exists fourvenues jsonb;

-- One night per Fourvenues event.
create unique index if not exists promoter_nights_fourvenues_code_key
  on public.promoter_nights (fourvenues_code)
  where fourvenues_code is not null;
