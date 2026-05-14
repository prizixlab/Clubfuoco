-- Track every "Get Tickets" tap on an external-platform event so we have
-- traffic numbers to show partner-program applications (Eventbrite Distribution,
-- DICE, etc.) when we apply for affiliate / reseller status.
create table if not exists public.ticket_clicks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.users(id) on delete set null,
  event_id        text not null,
  platform        text not null,        -- 'ra' | 'eventbrite' | 'dice' | ...
  event_title     text,
  venue_name      text,
  venue_place_id  text,
  event_date      timestamptz,
  display_price   integer,              -- cents, what we showed the user
  currency        text,
  clicked_at      timestamptz not null default now()
);

create index if not exists idx_ticket_clicks_platform_date on public.ticket_clicks (platform, clicked_at desc);
create index if not exists idx_ticket_clicks_user         on public.ticket_clicks (user_id, clicked_at desc);
create index if not exists idx_ticket_clicks_event        on public.ticket_clicks (event_id);

-- RLS: users can insert their own clicks; only service role reads
alter table public.ticket_clicks enable row level security;

create policy ticket_clicks_insert_own on public.ticket_clicks
  for insert
  to authenticated
  with check (auth.uid() = user_id or user_id is null);
