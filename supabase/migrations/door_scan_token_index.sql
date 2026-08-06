-- usedForToken() filters on token_ref ALONE (it's called per scan, on both
-- resolve and admit). The composite indexes lead with club_id/night_date, so
-- they can't serve that predicate — without this index every scan sequentially
-- scans the whole admission_scans ledger, which only ever grows.
-- Apply MANUALLY in the Supabase SQL editor.

create index if not exists admission_scans_tokenref_idx
  on public.admission_scans(token_ref);
