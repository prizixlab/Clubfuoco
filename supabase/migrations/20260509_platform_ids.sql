-- Add external ticketing platform ID columns to clubs table
alter table clubs
  add column if not exists dice_venue_id          text,
  add column if not exists xceed_venue_id         text,
  add column if not exists songkick_venue_id      text,
  add column if not exists eventbrite_organizer_id text;
