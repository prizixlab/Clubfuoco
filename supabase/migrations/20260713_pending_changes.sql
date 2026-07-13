-- Approval queue: schedule/offer changes pushed from the promoter app don't go
-- live until Club Fuoco staff approve them in the portal. Each row captures an
-- intended write (create/update/delete) against a live table; on approval the
-- portal applies it, on rejection it's discarded. The live tables are never
-- touched until approval, so the current version stays live during review.
-- Run in the SQL editor (production drifts from local DDL — apply manually).

create table if not exists public.pending_changes (
  id                uuid primary key default gen_random_uuid(),
  source            text not null,                 -- 'supplier' | 'promoter'
  submitter_user_id uuid references public.users(id) on delete set null,
  brand_id          uuid references public.partner_brands(id) on delete cascade,
  action            text not null,                 -- 'offer.create' | 'offer.update' | 'offer.delete' | 'night.create'
  entity            text not null,                 -- 'offer' | 'night'
  target_id         uuid,                          -- existing row for update/delete; null for create
  payload           jsonb,                         -- new values (create/update)
  summary           text not null,                 -- human-readable one-liner
  status            text not null default 'pending', -- 'pending' | 'approved' | 'rejected'
  created_at        timestamptz not null default now(),
  reviewed_at       timestamptz,
  note              text
);

create index if not exists pending_changes_status_idx
  on public.pending_changes(status, created_at desc);
create index if not exists pending_changes_submitter_idx
  on public.pending_changes(submitter_user_id, status);

alter table public.pending_changes enable row level security;

-- A submitter may read their OWN pending changes (the app shows them); writes
-- and approvals go through service-role server routes only.
drop policy if exists "own pending changes read" on public.pending_changes;
create policy "own pending changes read"
  on public.pending_changes for select
  using (submitter_user_id = auth.uid());
