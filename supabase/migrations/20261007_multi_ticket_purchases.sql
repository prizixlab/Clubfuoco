-- ── Several named tickets in one purchase ───────────────────────────────────
--
-- A promoter_guests row is a ticket: one name, one QR (`fuoco-invite:<id>`),
-- one Wallet pass. Until now a purchase made exactly one, so a buyer paying
-- for friends could only add anonymous plus-ones to their own QR.
--
-- A purchase is now a LEAD row plus zero or more COMPANION rows:
--   • the lead carries the Stripe ids, exactly as every purchase did before —
--     the webhook, verify-payment, the sweeper and the refund handler all keep
--     addressing it alone;
--   • each companion is its own named ticket, `paid_with` → its lead, with
--     `purchased_by_user` = the buyer and `claimed_by_user` null until the
--     buyer sends it on and the friend attaches it to their account.
--
-- The trigger below makes companions follow their lead: whatever settles the
-- lead (paid, refunded, disputed) settles the whole purchase, and deleting an
-- unpaid lead deletes its companions (ON DELETE CASCADE). No code path has to
-- remember to update N rows.
--
-- Stripe ids are deliberately NOT copied onto companions: nothing reads them
-- there, and copying them would collide with any unique index on those columns.
--
-- Idempotent — safe to paste twice.

alter table public.promoter_guests
  add column if not exists paid_with uuid
    references public.promoter_guests(id) on delete cascade;

alter table public.promoter_guests
  add column if not exists purchased_by_user uuid
    references public.users(id) on delete set null;

create index if not exists promoter_guests_paid_with_idx
  on public.promoter_guests(paid_with) where paid_with is not null;

create index if not exists promoter_guests_purchased_by_idx
  on public.promoter_guests(purchased_by_user) where purchased_by_user is not null;

create or replace function public.promoter_guests_follow_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.promoter_guests
     set payment_status  = new.payment_status,
         paid_at         = new.paid_at,
         hold_expires_at = new.hold_expires_at
   where paid_with = new.id
     and payment_status is distinct from new.payment_status;
  return null;
end
$$;

drop trigger if exists promoter_guests_follow_lead on public.promoter_guests;
create trigger promoter_guests_follow_lead
  after update of payment_status on public.promoter_guests
  for each row
  -- Leads only (a companion's own update never cascades further), and only
  -- when the status actually moved.
  when (new.paid_with is null and new.payment_status is distinct from old.payment_status)
  execute function public.promoter_guests_follow_lead();
