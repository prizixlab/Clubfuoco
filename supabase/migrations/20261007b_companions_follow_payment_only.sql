-- ── Companions follow their lead's PAYMENT, not its refund ───────────────────
--
-- 20261007_multi_ticket_purchases made companion tickets copy every
-- payment_status change of their lead. With per-ticket refunds (guest taps
-- Refund on ONE ticket), that is wrong: refunding the buyer's own ticket
-- would void every friend's ticket bought in the same payment.
--
-- Now the trigger only carries the one transition that is always shared —
-- the purchase being paid (pending → paid). Revocations are per ticket:
--   • a guest refund marks just that row (/guest/<id>/refund);
--   • a FULL Stripe refund or a dispute revokes the lead AND its companions
--     explicitly (lib/refunds.revokeForCharge).
-- Deleting an abandoned lead still deletes its companions (ON DELETE CASCADE).
--
-- Idempotent — safe to paste twice.

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
     and payment_status = 'pending';
  return null;
end
$$;

drop trigger if exists promoter_guests_follow_lead on public.promoter_guests;
create trigger promoter_guests_follow_lead
  after update of payment_status on public.promoter_guests
  for each row
  when (new.paid_with is null
        and old.payment_status = 'pending'
        and new.payment_status = 'paid')
  execute function public.promoter_guests_follow_lead();
