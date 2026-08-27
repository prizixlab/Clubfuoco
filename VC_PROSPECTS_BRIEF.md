# Club Fuoco — investor prospect list (auto-scraped)

**What:** a self-updating, fit-ranked list of **pre-seed / seed investors, global**,
matched to Club Fuoco (premium membership nightlife platform — consumer, two-sided,
experiences/marketplace). Built and maintained on **agentbox** (the Dell), same box
as the events/DJ pipelines.
**Created:** 2026-08-25.

---

## Where the file is

| | |
|---|---|
| Host | `agentbox` — `10.0.0.235` (home) / `100.125.231.19` (Tailscale) |
| **The list** | `~/scraper/intel/vc/vcs.csv` — ranked best-fit first |
| Source of truth | `~/scraper/intel/vc/vcs.sqlite` (table `vcs`, key = `fund`) |
| Script | `~/scraper/vc_research.py` |
| Log | `~/scraper/logs/vc.log` |

Pull it:
```bash
scp yvinnik@10.0.0.235:/home/yvinnik/scraper/intel/vc/vcs.csv ~/Desktop/
```
Open in Numbers/Excel — it's UTF-8-with-BOM so accents render. Sort/filter is already
done (best fit at the top), but you can re-sort by any column.

---

## How to read a row

| Column | Meaning |
|---|---|
| `rank` | Position by fit (1 = best fit). Re-numbers each refresh. |
| `fund` | Investor / firm name. **This is the stable key.** |
| `type` | VC firm / Angel network / Family office / Accelerator / Syndicate / … |
| `fit_score` | 0–100, how well they match Club Fuoco (see scoring below). |
| `stage_fit_preseed_seed` | `yes` = they back idea / prototype / early-revenue rounds. |
| `check_size` | Their stated cheque range (e.g. `$100k to $1M`). |
| `stages` | Which stages they do (1 Idea → 6 Pre-IPO). 1–3 = our zone. |
| `leads` | Whether they lead rounds (Always / Sometimes) — can anchor your round. |
| `target_countries` | Where they invest. Global raise, so most qualify. |
| `hq`, `website`, `linkedin` | Outreach details (filled for top funds first). |
| `categories_matched` | **Why they're here** — which fit-lists surfaced them (e.g. `vice/nightlife | consumer | marketplace`). More = stronger fit. |
| `thesis`, `value_add` | Their own words on what they back. |
| `openvc_profile` | Their OpenVC page — has a "Find intros / Send email" button. |

**Start at the top.** The `fit_score ≥ 55` band is your warm shortlist; below ~35 is
the wide net (kept for coverage, not priority).

---

## How "fit" is scored (so you can trust / adjust it)

Points for:
- **Thesis match** — surfaced by consumer / nightlife / vice / entertainment /
  community / marketplace / app / creator / luxury lists (heaviest weight; multiple
  lists = higher).
- **Stage** — backs stages 1–3 (pre-seed/seed). Growth/PE-only funds are penalised.
- **Cheque size** — overlaps the ~$25k–$3M pre-seed/seed range; giant-cheque funds
  penalised.
- **Leads rounds** — small bonus.
- **Geo** — tiny bonus for Spain / Barcelona / Europe / global (warm or local), but
  this is a **global** raise so geo is a nudge, not a filter.
Points off: strong B2B / SaaS / deep-tech / biotech / climate signals with no
consumer angle.

The knobs (keyword banks, weights, category list) live at the top of
`vc_research.py` — easy to tune if you want to widen or tighten.

---

## Where the names come from

OpenVC's public curated investor lists (openvc.app) — the ~35 categories that fit a
consumer nightlife app: `vicetech`, `entertainment`, `community`, `marketplace`,
`b2c`, `app`, `social-media`, `creator-economy`, `luxury`, plus adjacent
lifestyle/experience lists, the pre-seed/seed/angel/cheque-size stage lists, and a
few warm-local lists (Barcelona, Madrid, Spain angels, Europe). Each investor is
tagged with every list that surfaced them.

**Coverage caveat:** OpenVC is broad but not exhaustive. Crunchbase/LinkedIn would add
more but are paywalled + anti-bot (against ToS to scrape headlessly), so they're
deliberately not used. A future add-on could watch funding-announcement news for
"who just backed a nightlife/social app" and fold those investors in — say the word.

---

## It updates itself (this is a pipeline, not a one-off)

| When (UTC) | Run | Does |
|---|---|---|
| **09:00, Mon–Sat** | `vc_research.py light` | Refresh the core fit-lists (shallow) + enrich a batch of top funds. |
| **09:30, Sundays** | `vc_research.py full` | Deep re-sweep of **all** fit categories + heavy enrichment. |

Both dedupe by fund (a fund seen on ten lists is one row), never delete, and keep
`first_seen` so newly-surfaced investors are identifiable. Run one by hand anytime:
```bash
ssh yvinnik@10.0.0.235 'cd ~/scraper && ./venv/bin/python3 vc_research.py full'
```

---

## Using the list

1. Work top-down; the `categories_matched` column tells you the angle to open with
   ("you back community-driven consumer marketplaces — that's exactly Club Fuoco").
2. For warm intros, filter `target_countries` for Spain/Barcelona or use the
   `openvc_profile` "Find intros" button.
3. `leads = Always/Sometimes` + `stage_fit = yes` = someone who could **anchor** the
   round, not just fill it.
