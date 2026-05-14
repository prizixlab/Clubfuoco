-- Lets a user permanently dismiss the "How was last night?" prompt
-- for a specific booking without submitting a survey.
alter table public.bookings
  add column if not exists survey_dismissed_at timestamptz;

create index if not exists idx_bookings_survey_dismissed_at
  on public.bookings (user_id, survey_dismissed_at)
  where survey_dismissed_at is not null;
