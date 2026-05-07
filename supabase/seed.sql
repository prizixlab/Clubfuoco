-- ============================================================
-- CLUB FUOCO — Seed Data (5 partner clubs)
-- Run AFTER 001_initial_schema.sql
-- ============================================================

insert into public.clubs (
  name, slug, description, address, neighborhood,
  lat, lng, music_genres, max_capacity,
  general_entry_price, vip_table_min_spend,
  instagram_handle, is_active, is_featured
) values
(
  'Opium Barcelona',
  'opium-barcelona',
  'Beachfront nightclub with world-class DJs and an unmatched terrace overlooking the Mediterranean.',
  'Passeig Marítim de la Barceloneta, 34, 08003 Barcelona',
  'Barceloneta',
  41.3779, 2.1893,
  array['house', 'open format', 'commercial'],
  1500, 25.00, 500.00,
  'opiumbarcelona', true, true
),
(
  'Pacha Barcelona',
  'pacha-barcelona',
  'Iconic global brand meets Barcelona''s nocturnal heartbeat. House and electronic on the seafront.',
  'Passeig Marítim de la Barceloneta, 38, 08003 Barcelona',
  'Barceloneta',
  41.3776, 2.1900,
  array['house', 'electronic', 'techno'],
  1200, 20.00, 450.00,
  'pachaborcelona', true, true
),
(
  'Sutton Club',
  'sutton-club',
  'The most exclusive address on Diagonal. VIP booths, A-list crowd, hip-hop and R&B until dawn.',
  'Carrer de Tuset, 13, 08006 Barcelona',
  'Upper Diagonal',
  41.3966, 2.1476,
  array['hip-hop', 'r&b', 'urban'],
  800, 35.00, 800.00,
  'suttonbarcelona', true, false
),
(
  'Shôko Barcelona',
  'shoko-barcelona',
  'Japanese-inspired design meets Barcelona beach energy. Latin, reggaeton, and commercial beats.',
  'Passeig Marítim de la Barceloneta, 36, 08003 Barcelona',
  'Barceloneta',
  41.3778, 2.1895,
  array['latin', 'reggaeton', 'commercial'],
  1000, 15.00, 350.00,
  'shokobarcelona', true, false
),
(
  'Razzmatazz',
  'razzmatazz',
  'Five rooms, five sounds. Barcelona''s legendary multi-floor venue — indie, techno, pop, and everything in between.',
  'Carrer dels Almogàvers, 122, 08018 Barcelona',
  'Poblenou',
  41.4012, 2.1988,
  array['indie', 'techno', 'electronic', 'pop'],
  3000, 18.00, 400.00,
  'salarazzmatazz', true, true
);

-- ============================================================
-- Insert default live_status for each club (closed / no data)
-- In production these are updated by club staff each night
-- ============================================================
insert into public.live_status (club_id, crowd_percentage, crowd_label, is_open)
select id, 0, 'empty', false
from public.clubs
on conflict (club_id) do nothing;

-- ============================================================
-- Sample drink specials (active tonight)
-- ============================================================
insert into public.drink_specials (club_id, name, description, original_price, special_price, is_active)
select
  c.id,
  spec.name,
  spec.description,
  spec.original_price,
  spec.special_price,
  true
from public.clubs c
cross join lateral (values
  ('2-for-1 Mojitos', 'House special until 01:00', 18.00, 9.00),
  ('Free Shot with QR', 'Show your Club Fuoco QR at the bar', 8.00, 0.00)
) as spec(name, description, original_price, special_price)
where c.slug = 'opium-barcelona';

insert into public.drink_specials (club_id, name, description, original_price, special_price, is_active)
select
  c.id,
  spec.name,
  spec.description,
  spec.original_price,
  spec.special_price,
  true
from public.clubs c
cross join lateral (values
  ('Sangria Pitchers €15', 'Premium house sangria, serves 4', 28.00, 15.00),
  ('Ladies drink free before 01:00', 'Valid at bar with entry ticket', 10.00, 0.00)
) as spec(name, description, original_price, special_price)
where c.slug = 'shoko-barcelona';
