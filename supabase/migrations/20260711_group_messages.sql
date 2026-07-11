-- Group chat: a lightweight message thread per booking_group so members can
-- coordinate the night ("where are we meeting?", "running late"). Plus a
-- per-member last_read_at so the app can show unread counts. Run in the SQL
-- editor. API routes use the service client, so RLS here is defense-in-depth
-- for any direct-PostgREST access.

-- 1. Messages table.
create table if not exists public.booking_group_messages (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.booking_groups(id) on delete cascade,
  user_id    uuid not null references public.users(id),
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists group_messages_group_idx
  on public.booking_group_messages(group_id, created_at);

-- 2. Read tracking: when the viewer last opened the thread.
alter table public.booking_group_members
  add column if not exists last_read_at timestamptz;

-- 3. RLS — only members of the group can read/write its messages.
alter table public.booking_group_messages enable row level security;

drop policy if exists "See messages in your groups" on public.booking_group_messages;
create policy "See messages in your groups"
  on public.booking_group_messages for select
  using (
    exists (select 1 from public.booking_groups g
              where g.id = group_id and g.organizer_id = auth.uid())
    or exists (select 1 from public.booking_group_members m
                 where m.group_id = booking_group_messages.group_id
                   and m.user_id = auth.uid())
  );

drop policy if exists "Post messages to your groups" on public.booking_group_messages;
create policy "Post messages to your groups"
  on public.booking_group_messages for insert
  with check (
    user_id = auth.uid()
    and (
      exists (select 1 from public.booking_groups g
                where g.id = group_id and g.organizer_id = auth.uid())
      or exists (select 1 from public.booking_group_members m
                   where m.group_id = booking_group_messages.group_id
                     and m.user_id = auth.uid())
    )
  );
