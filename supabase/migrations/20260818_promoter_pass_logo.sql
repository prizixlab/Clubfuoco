-- Promoter pass logos: uploaded image, or a wordmark they typeset themselves.
--
-- PassKit has no typography controls — pass.json carries no font or text-colour
-- field, and `logoText` is drawn by iOS in the system font tinted with
-- foregroundColor. The only way to give a promoter a font and a colour is to
-- render their wordmark to a PNG on the device and ship it in the logo slots,
-- which is the same path an uploaded image takes. So both are one pipeline and
-- these columns describe whichever produced the bitmaps.
--
-- `logo_text` (already present) keeps doing double duty: it is the string we
-- typeset, AND the plain-logoText fallback if the render or upload ever fails,
-- so a promoter who typed a wordmark still gets their name on the pass.

alter table public.promoter_pass_themes
  add column if not exists logo_mode  text not null default 'none'
    check (logo_mode in ('none', 'text', 'image')),
  -- PostScript name of a font the promoter app ships. Not free text at render
  -- time: the app maps it back through a fixed list, so an unknown value
  -- degrades to the default face rather than a missing glyph.
  add column if not exists logo_font  text,
  -- #RRGGBB for a typeset wordmark. Validated against the pass background for
  -- contrast on write, same rule as the accent.
  add column if not exists logo_color text;

comment on column public.promoter_pass_themes.logo_mode is
  'none | text (wordmark typeset on-device) | image (promoter upload). Describes what produced logo_*_url.';

-- Backfill: a row that already carries wordmark text was in text mode before
-- this column existed.
update public.promoter_pass_themes
   set logo_mode = 'text'
 where logo_mode = 'none'
   and coalesce(trim(logo_text), '') <> '';
