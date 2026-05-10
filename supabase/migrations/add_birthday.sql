-- Add birthday column to users table for birthday promotions
alter table users add column if not exists birthday date;

-- Index so we can efficiently query "who has a birthday today/this month"
create index if not exists users_birthday_idx on users (
  extract(month from birthday),
  extract(day from birthday)
);
