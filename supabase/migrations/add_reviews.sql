-- Store up to 10 reviews per club (seeded from Google, grown with our own over time)
alter table clubs add column if not exists reviews jsonb not null default '[]'::jsonb;

-- Index so we can efficiently find clubs with/without reviews
create index if not exists clubs_reviews_idx on clubs using gin (reviews);
