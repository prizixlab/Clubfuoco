# Club Fuoco — investor auto-outreach

Built 2026-08-26. Sits on top of the existing `vc_research.py` prospecting
pipeline and turns it into an actual outreach channel.

```
vc_research.py      WHO to pitch      3,132+ fit-scored funds  (OpenVC)
      |
vc_contacts.py      HOW to reach them  real name, domain, email
      |
vc_outreach.py      the send           Resend, investor@clubfuoco.com
```

---

## Why vc_contacts.py had to exist

The prospect list was never mailable. OpenVC login-gates both the fund's
website and its email, so before this work:

| field | state |
|---|---|
| email | column did not exist — zero addresses anywhere |
| website | 41/3132 filled, and all 41 were the same jsdelivr CSS URL |
| hq | 0/3132 |
| fund name | 844 truncated (`Griffin Gaming Par...`) |
| enriched | 85/3132 |

Three bugs in `vc_research.py`, now fixed (backup: `vc_research.py.bak-*`):

- **`:388` website** — took the first absolute `href` on the profile page. The
  blocklist had no CDN entries, so the `<head>` stylesheet won every time.
  *There is in fact no fund website on the public profile at all* — it is
  gated. Removing the bogus value is the fix; domains now come from search.
- **`:173` + `:231` truncated names** — the parser preferred OpenVC's
  `invOverflow` *display* cell, which is ellipsis-truncated, over the full
  name in the `href` slug, then built `profile_url` from the stub. That
  produced 844 dead profile links. Now the slug is canonical and the display
  cell is only used when it is not truncated.
- **`:398` hq** — regex never matched. Now parsed from the `Locations … HQ` line.

Legacy stub rows are folded into their correct twin by `merge_truncated.py`
(conservative: only merges when exactly one full name matches the prefix).

---

## vc_contacts.py

`~/scraper/vc_contacts.py`, modes `names | profile | domain | email | all`.
Writes into the existing `vcs.sqlite` (additive columns only) and exports
`~/scraper/intel/vc/vc_contacts.csv`.

- **profile** — re-reads the OpenVC profile for HQ and the **named team**
  (name, title, personal thesis quote). Gives us a human to greet.
- **domain** — finds the fund's real site. OpenVC does not publish it, so it
  searches, scores candidate hosts against the fund name, then **verifies** by
  fetching the site and confirming the name appears. Unverified → left blank
  rather than guessed.
- **email** — crawls `/contact`, `/about`, `/team` etc. on the verified
  domain, prefers `mailto:` links, and keeps only addresses **on the fund's
  own domain**. Classifies each as `pitch` / `generic` / `person` and picks
  the best: a `pitch@` or `opportunities@` inbox beats `info@`.

Validated hits: `pitch@mercuri.fund`, `opportunities@moonfire.com` — i.e. the
inboxes those funds created specifically to receive decks.

### Domain verification — don't loosen this

Mailing a pitch to the wrong firm is worse than not mailing at all, so a
domain is only accepted when **both** hold:

1. the fund name appears as a **phrase** (tokens adjacent, stopwords like
   "ventures"/"capital" dropped), or the whole name is in the host itself; and
2. the page reads like an investor — 3+ of *portfolio, invest, venture, fund,
   founder, thesis, pre-seed…*

Both rules exist because of real false positives caught in testing:

| fund | matched | why it was wrong |
|---|---|---|
| Hobart Ventures | `hobartcorp.com` | commercial food equipment — passed on the token "hobart" |
| First Move | `firstny.com` | "first" and "move" both appeared, scattered, in a long page |
| Wildwood Ventures | `wildwoodsnj.com` | a New Jersey beach-town tourism site |
| Otium Capital | `otiumtour.com` | a tour company |
| Quam Venture Capital | `quamproperties.com` | a property company |

The last three share one cause: once stopwords like *Ventures* / *Capital*
are dropped, those names reduce to a **single token** ("wildwood"), which any
domain containing that word satisfies. So for single-token names the host must
**be** the name (`moonfire.com`, `mayfield.com`) — not merely contain it.
`purge_bad.py` re-runs the current matcher over already-resolved domains and
clears any that no longer pass; run it after changing the rules.

`test_verify.py` on the box pins all of this, including the case that looks
like a false positive but isn't: `techne.vc` really is *Techne Infiniti
Ventures* (its footer names the firm). Run it after touching the matcher.

Truncated stub names are **excluded** from domain search entirely — searching
"Techne Infiniti Ve..." resolves confidently to the wrong firm. They wait for
`merge_truncated.py`.

**Politeness / safety.** Search engines are the fragile dependency here:
three engines in rotation (DDG → Mojeek → Bing), 12s+ between queries, a
120/day shared budget, and any anti-bot response (HTTP 202/429) benches that
engine for 20 minutes. Anti-bot challenges are **respected, never solved**.
flock prevents overlapping runs; every pass is resumable and additive.

---

## vc_outreach.py

`~/scraper/vc_outreach.py`.

```bash
./vc_outreach.py edit                  # edit the email copy in $EDITOR
./vc_outreach.py preview -n 5          # render emails, send nothing
./vc_outreach.py send                  # DRY RUN — logs what would go
./vc_outreach.py send --send -n 20     # actually send, 20 max
./vc_outreach.py status                # sent / failed / suppressed
./vc_outreach.py suppress a@b.com      # never mail again
```

### Editing the email — `~/scraper/vc_email.txt`

The copy is **not** in the Python. It's a plain text file you can edit
freely; the script reads it at send time. First line is the subject:

```
Subject: Club Fuoco (pre-seed) — membership nightlife, Barcelona

{greeting}

{opener}

Club Fuoco is a premium membership platform for nightlife. ...
```

Blank lines separate paragraphs. The HTML version is generated from this
same text — paragraphs become `<p>`, bare URLs become links, and the block
after `--` becomes the small-print footer. **There is only one file to edit,
not a text and an HTML copy.**

Placeholders available:

| placeholder | fills with |
|---|---|
| `{greeting}` | `Hi Esha,` or `Hi Moonfire Ventures team,` |
| `{opener}` | thesis-matched first line (see below) |
| `{angle}` | just the matched thesis, e.g. `you invest in marketplaces` |
| `{first_name}` `{fund}` | partner's first name / fund name |
| `{hq}` `{check_size}` | from the enriched list |
| `{deck_url}` `{site_url}` | from env |
| `{from_name}` `{from_email}` `{postal}` | from env |

Mistype one and the script **refuses to run**, printing the bad name and the
valid list — it will not send a half-rendered email. Always
`preview` after editing; that renders against real rows without sending.

To try wording without touching the live file:
`./vc_outreach.py preview --template /tmp/draft.txt`

### Safety model

- **Dry run is the default.** Nothing sends without an explicit `--send`.
- Each address is written to the `outbox` table **before** the API call, so a
  crash or re-run can never double-send.
- Suppression list checked on every send and honoured even if the CSV still
  lists the address.
- Caps: 40/day, 25/run, 45s between sends. A typo cannot fire 3,000 emails.
- **Refuses to run** without `VC_DECK_URL` and `VC_POSTAL` set — commercial
  email legally needs a real postal address and an opt-out, and a deck link
  that goes nowhere wastes the send.

### Config — `~/scraper/secrets/vc.env` (chmod 600)

Settings live in that file, not only in the shell, so cron and an interactive
run see the same values; an explicit shell export still overrides it. A
missing config used to look identical to a deliberate refusal to send.

| var | default | notes |
|---|---|---|
| `RESEND_API_KEY` | — | required for `--send`. Use a key created **for outreach**, not the one sending booking confirmations — it can then be revoked on its own |
| `VC_FROM_EMAIL` | `investor@clubfuoco.com` | domain already verified in Resend |
| `VC_DECK_URL` | `https://clubfuoco.com/deck` | stable link, swappable file — see below |
| `VC_POSTAL` | — | **required**; real postal address, printed in every footer. Set 2026-08-26 to the Atlanta address |
| `VC_DAILY_CAP` | 40 | |
| `VC_RUN_CAP` | 25 | |
| `VC_SLEEP` | 45 | seconds between sends |
| `VC_MIN_FIT` | 55 | the warm-shortlist threshold |
| `VC_REPLY_TO` | `investor@reply.clubfuoco.com` | subdomain received by Resend Inbound |
| `VC_INBOX` | `resend` | or `imap` to read iCloud directly |
| `VC_FORWARD_TO` | — | inbox that sorted replies are forwarded to; the only address `vc_replies` can mail |
| `VC_FORWARD_SKIP` | `auto` | buckets not worth forwarding |
| `VC_IMAP_USER` / `VC_IMAP_PASS` | — | only for `VC_INBOX=imap`; **app-specific** password |

### DNS for the reply subdomain (one-time)

In Resend → Domains, add **`reply.clubfuoco.com`** and enable receiving; the
dashboard prints the MX record to add. It must be the **lowest-priority** MX on
that subdomain or mail won't route to Resend. Do **not** touch the apex
`clubfuoco.com` MX — that is iCloud and must stay iCloud.

### Personalisation

Greeting uses the partner's first name where `vc_contacts.py` found one,
otherwise "Hi <Fund> team". The name must be **two parts and contain no site
furniture** — the OpenVC team block sits next to page navigation, and a looser
rule produced a real, ready-to-send *"Hi Webinars,"*. When in doubt it falls
back to the team greeting; a wrong name is worse than a generic one. (50 stored
team rows had to be cleaned of this.) The opening line cites the *specific* OpenVC
list that surfaced the fund — "you invest in vice and nightlife" for a
vicetech match, "you invest in marketplaces" for a marketplace match — and
falls back to a neutral line when there is no category match, so it never
claims a thesis the fund does not have.

---

## vc_replies.py — sorting what comes back

`~/scraper/vc_replies.py`. Reads the replies and sorts each into the three
buckets that actually matter, plus two housekeeping ones.

```bash
./vc_replies.py fetch                      # pull new replies over IMAP
./vc_replies.py classify                   # sort them (local llama3.1:8b)
./vc_replies.py list --bucket interested --full
./vc_replies.py forward                    # push them into Yakov's inbox
./vc_replies.py act                        # suppress the passes
./vc_replies.py due                        # 'later' funds whose date arrived
./vc_replies.py set partner@fund.com no    # override the model
```

| bucket | meaning | what `act` does |
|---|---|---|
| `interested` | wants to proceed — call, deck, questions, forwarded to a partner | **nothing**; surfaced for Yakov |
| `later` | door open, timing wrong — too early, fund between vehicles | diarised; `due` surfaces it |
| `no` | a pass, including the polite kind | added to suppression |
| `auto` | out-of-office, autoresponder, bounce | marked handled, **not** suppressed |
| `unclear` | model wasn't sure | left for a human |

**It never mails an investor.** It reads, sorts and suppresses. The one thing
it sends is `forward`, and that goes to `VC_FORWARD_TO` — a single configured
address, never a value read from the database, so no code path can put mail in
front of a VC. Every reply an investor receives is written by Yakov. An LLM
autoresponding to VCs is how you lose a round — do not add a "draft and send"
mode.

### forward — replies land in a real inbox

Since Resend receives the mail rather than iCloud, each sorted reply is
re-sent to Yakov. **`Reply-To` is set to the investor**, so hitting Reply in
Mail answers the VC directly and the thread moves into his normal mailbox from
there. Subject is prefixed with the bucket (`[interested] Moonfire Ventures:
…`) so the inbox itself is triaged.

- `forwarded` flag is set **before** the API call, same discipline as
  `vc_outreach` — a crash mid-send can't put the same reply in his inbox twice.
  It is rolled back if the call actually fails.
- `auto` (out-of-offices, bounces) is skipped by default — inbox noise.
  `VC_FORWARD_SKIP` controls it; they stay in the DB either way.
- `--dry-run` renders without sending.
- Note the forward arrives *from* `investor@clubfuoco.com`, so replying from
  Mail uses whichever account received it — pick the right From alias if the
  investor should see `investor@clubfuoco.com`.

- **Replies arrive via Resend Inbound** (`VC_INBOX=resend`). Every send carries
  `Reply-To: investor@reply.clubfuoco.com` while the From line still reads
  `investor@clubfuoco.com`. The MX record sits on the **subdomain only**, so
  `clubfuoco.com` keeps its iCloud MX and `tickets@` / personal mail is
  untouched — pointing the apex at Resend would take the whole mailbox away.
- **Polled, not webhooked.** `GET api.resend.com/emails/receiving` lists
  metadata; each body needs its own `GET /emails/receiving/{id}` (the list
  endpoint does not include it). Resend stores received mail 30 days, far
  longer than the gap between runs, so there is nothing to deploy and no
  public endpoint to expose — which matters because the box has neither.
- **`VC_INBOX=imap` is the fallback**: reads iCloud at `imap.mail.me.com:993`
  with an **app-specific** password, mailbox opened `readonly=True`. Use it if
  the subdomain route is ever unwound.
- Replies land in Resend rather than the iCloud mailbox, so `forward` (below)
  re-sends each sorted one to `VC_FORWARD_TO`. First reply captured and sorted
  by the tool, human takes over in his own mail client after.
- **It only ingests mail from funds we actually mailed** — matched against the
  `outbox` table by address, then by domain (an analyst often replies from a
  different address than the `info@` we wrote to). Anything else in the inbox
  is skipped; this must never become a general reader of Yakov's mail.
- **Rules run before the LLM.** An out-of-office is not investor sentiment, and
  the 8B model reads "I am currently away" as a `later`. Bounces,
  autoresponders and empty bodies are caught deterministically.
- **Quoted history is stripped** before classification — otherwise our own
  pitch coming back in the quote turns a one-word "no thanks" into
  `interested`.
- **Hand-offs are rescued from `no` by a regex net (`RX_HANDOFF`).** The 8B model
  read *"forwarding to my colleague Marta who covers consumer marketplaces"* as a
  pass and invented "out of thesis" as the reason — at **high** confidence, so
  `act` would have suppressed a live intro forever. An internal forward is the
  warmest signal a cold email gets. The net can only ever move a reply OUT of
  `no`; it can never manufacture interest the model didn't see.
- **`act` deliberately ignores low-confidence passes.** A `no` that was really
  a `later` silently deletes a live lead. Those wait for a human; `list` flags
  them with `*`.
- `test_replies.py` pins the prompt against 10 real-shaped VC replies,
  including the compliment-sandwich pass. Run it after touching the prompt.

Classification is local — investor correspondence never leaves the box.
Inference is CPU-only on the i3, so expect tens of seconds per reply; that is
fine for the volume involved.

## The deck link — `https://clubfuoco.com/deck`

**The URL never changes; the file behind it does.** A link sitting in an
investor's inbox from three months ago serves today's deck.

```bash
python3 scripts/upload_deck.py path/to/new-deck.pdf   # that's the whole swap
```

- Stored at the fixed path `investor/deck.pdf` in Supabase Storage. The bucket
  is **private** — `src/app/deck/route.ts` streams it with the service key, so
  the raw Storage URL can't be shared around or indexed, and gating or
  access-logging can later be added in that one file.
- `/deck` had to be added to `WEB_ALLOWED` in `src/middleware.ts` — the web app
  is invite-only and bounces everything else to `/`.
- **The route deliberately sends `Cache-Control: no-store` and fetches storage
  with a cache-buster.** The first version used supabase-js `.download()` with
  a 300s TTL and kept serving the *previous* deck for minutes after a swap,
  which defeats the entire point. Don't reintroduce caching here — the file is
  ~1MB and correctness matters more.
- `upload_deck.py` retries 3× on the TLS drops Supabase throws on multi-MB
  uploads ("LibreSSL … bad record mac"), which hit twice during setup.

Verified end-to-end: uploaded deck A, `/deck` served A byte-for-byte; uploaded
deck B, `/deck` served B immediately; swapped back, served A immediately.

## Deliverability — read this before scaling up

`investor@clubfuoco.com` is on the **same domain as `tickets@clubfuoco.com`**,
which sends booking confirmations. Cold outreach and transactional mail
sharing a reputation is the main risk here:

- Resend's terms do not permit cold outreach on their shared IPs. A spam-
  complaint spike can suspend the account — taking booking email down with it.
- The mitigation is a separate subdomain (e.g. `investor@out.clubfuoco.com`)
  with its own DKIM, or a dedicated cold-outreach provider. The From address
  still reads as Club Fuoco.

The caps above keep volume low enough to be defensible, and 140 warm funds
matters far more than 3,000 sprayed ones. But the domain split is the real fix.

---

## Run order

```bash
~/scraper/venv/bin/python ~/scraper/merge_truncated.py --apply
~/scraper/venv/bin/python ~/scraper/vc_contacts.py all      # repeat; caps per run
~/scraper/venv/bin/python ~/scraper/vc_outreach.py preview -n 5
~/scraper/venv/bin/python ~/scraper/vc_outreach.py send --send -n 20
# then, a day or two later, and thereafter:
~/scraper/venv/bin/python ~/scraper/vc_replies.py fetch
~/scraper/venv/bin/python ~/scraper/vc_replies.py classify
~/scraper/venv/bin/python ~/scraper/vc_replies.py act
~/scraper/venv/bin/python ~/scraper/vc_replies.py list --bucket interested --full
```

`vc_contacts.py all` is capped per run (40 profile / 30 domain / 30 email) and
is resumable, so run it repeatedly — or on cron — until `vc_contacts.csv`
stops gaining addresses. Nothing is destructive; every pass only fills blanks.
