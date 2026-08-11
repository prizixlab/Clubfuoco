insert into public.djs
  (ra_artist_id,name,ra_followers,genres,instagram,soundcloud,website,known_venues,regions,bcn_events_seen,ra_url,image_url,cover_image_url,bio)
values
  ('66527','Yaeji',41899,array['Deep House','House']::text[],'https://www.instagram.com/kraejiyaeji','https://www.soundcloud.com/kraejiyaeji','http://yaeji.nyc',array['Knockdown Center','Bossa Nova Civic Club','Nowadays','Sunnyvale','Elsewhere']::text[],array['New York City','Los Angeles','Chicago','San Francisco/Oakland','Barcelona']::text[],2,'https://ra.co/dj/yaeji','https://static.ra.co/images/profiles/yaeji.jpg?dateUpdated=1599050856000','https://static.ra.co/images/profiles/lg/yaeji.jpg?dateUpdated=1599050856000',null),
  ('24430','Kolsch',32680,array['Electronica']::text[],'https://www.instagram.com/kolschofficial','https://www.soundcloud.com/kolsch',null,array['Ushuaïa Ibiza','Gewölbe','fabric','Hï Ibiza','Amnesia Ibiza']::text[],array['Ibiza','Amsterdam','London','Paris','Barcelona']::text[],2,'https://ra.co/dj/kolsch','https://static.ra.co/images/profiles/square/kolsch.jpg?dateUpdated=1642091771000','https://static.ra.co/images/profiles/lg/kolsch.jpg?dateUpdated=1642091771000',null),
  ('2887','KiNK',32044,array['House','Techno']::text[],null,'https://www.soundcloud.com/kink','http://www.pbpm.net',array['Berghain','Panorama Bar','Säule','fabric','Watergate','Mondo','Le Sucre']::text[],array['Amsterdam','London','Berlin','Barcelona','Ibiza']::text[],2,'https://ra.co/dj/kink','https://static.ra.co/images/profiles/kink.jpg?dateUpdated=1628682396000','https://static.ra.co/images/profiles/lg/kink.jpg?dateUpdated=1628682396000',null),
  ('55225','Mathame',23034,array['Progressive House','Techno']::text[],'https://www.instagram.com/mathame_','https://www.soundcloud.com/mathame',null,array['Amnesia Ibiza','Hï Ibiza','Soho Garden DXB','Cavo Paradiso','Club Space Miami']::text[],array['Ibiza','Barcelona','London','Amsterdam','Paris']::text[],2,'https://ra.co/dj/mathame','https://static.ra.co/images/profiles/square/mathame.jpg?dateUpdated=1664800771000',null,null),
  ('4213','Rodriguez Jr.',22791,array['Electronica']::text[],'https://www.instagram.com/rodriguezjrmusic','https://www.soundcloud.com/rodriguezjrmusic','http://www.rodriguezjr.net',array['Watergate','The Gates Diagonal','Hive Club','Ritter Butzke','Harry Klein']::text[],array['Berlin','Miami','Barcelona','Amsterdam','Paris']::text[],2,'https://ra.co/dj/rodriguezjr','https://static.ra.co/images/profiles/square/rodriguezjr.jpg?dateUpdated=1747812805383','https://static.ra.co/images/profiles/lg/rodriguezjr.jpg?dateUpdated=1747812805383',null),
  ('4501','Catz ''N Dogz',22697,array['Tech House','Techno']::text[],'https://www.instagram.com/catz_n_dogz','https://www.soundcloud.com/catzndogz','http://www.catzndogz.pl',array['Watergate','Farbfernseher','Hï Ibiza','Tama','Space Ibiza']::text[],array['Berlin','Ibiza','London','Barcelona','Warsaw']::text[],2,'https://ra.co/dj/catzndogz','https://static.ra.co/images/profiles/catzndogz.jpg?dateUpdated=1481639086200',null,null)
on conflict (ra_artist_id) do nothing;
-- Seed DJ-set slots onto real clubs (picks partner clubs, else any active club),
-- so the Featured DJ box is visible immediately. Safe to re-run.
with picks as (
  select id, row_number() over (order by is_partner desc, is_featured desc, name) as rn
  from public.clubs
  where is_active is not false
)
insert into public.club_dj_sets (club_id, ra_artist_id, residency_label, night, sort)
select p.id, v.ra_artist_id, v.residency_label, v.night, v.sort
from (values
  (1, '2887',  'Resident', 'Saturdays', 0),   -- KiNK
  (1, '66527', 'Guest',    'Fridays',   1),   -- Yaeji (same club, 2nd slot)
  (2, '55225', 'Resident', 'Saturdays', 0),   -- Mathame (second club)
  (3, '4213',  'Resident', 'Thursdays', 0)    -- Rodriguez Jr. (third club)
) as v(rn, ra_artist_id, residency_label, night, sort)
join picks p on p.rn = v.rn
on conflict (club_id, ra_artist_id) do nothing;
