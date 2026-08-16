#!/usr/bin/env python3
"""Venue → club linking for the agentbox, with a learned rule store.

The problem: RA writes a venue's name however the promoter typed it. We hold
"Moog", RA says "Moog Club"; we hold "Disco City Hall", RA says "City Hall";
"La Terrrazza" has three r's on both sides but not the same suffix. Exact
matching resolved barely a third of Barcelona nights, and an unlinked Barcelona
venue reads to the user as if the app is broken.

So linking runs in tiers, cheapest and most certain first:

    1. alias     a decision already made and remembered (incl. "not ours")
    2. exact     identical after normalisation
    3. contains  one normalised name contains the other
    4. subset    one side's meaningful words are a subset of the other's
    5. shared    a single shared meaningful word, unique hit
    6. llm       the local model is asked about the residue

Tiers 2-5 are deliberately GENEROUS: a link is the useful outcome, and every
tier still refuses when more than one club matches, because sending someone to
the wrong door is the one failure worth avoiding. `method` is stored on every
decision, so a tier that turns out to be too loose can be audited and revoked
in bulk without re-deriving anything.

The point of the alias store is that tier 6 is paid ONCE per venue. Whatever
the model decides — a club, or "not one of ours" — becomes a rule the
deterministic linker applies on every later run, so the system gets faster and
more accurate the longer it runs, and the model is only ever asked about names
it has genuinely never seen.

Usage:
    from venue_link import VenueLinker
    linker = VenueLinker(clubs)              # clubs: [{id, name, is_active}]
    club_id, method = linker.resolve("Moog Club", city="Barcelona")
    linker.resolve_residue()                 # ask the model about what's left
    linker.report()
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import pathlib
import re
import sqlite3
import unicodedata
import urllib.request

ROOT = pathlib.Path.home() / "scraper"
ALIAS_DB = ROOT / "intel/venue_aliases.sqlite"
OLLAMA = "http://localhost:11434/api/generate"
MODEL = "llama3.1:8b"

# The city we actually operate in. A venue anywhere else is definitionally not
# one of our clubs, so it is recorded as a negative alias for free rather than
# spent on a model call.
HOME_CITY = "barcelona"

log = logging.getLogger("venue_link")

# Words that describe what a place IS or WHERE it is, never which one it is.
# Kept in step with src/lib/venue-match.ts and its Swift twin.
GENERIC = {
    "barcelona", "club", "bar", "the", "lounge", "hotel", "cafe", "cafes",
    "music", "night", "live", "room", "space", "house", "disco", "dance",
    "party", "venue", "stage", "place", "sala", "local", "bcn", "spain",
    "restaurant", "restaurante", "cocktail", "cocteleria", "rooftop", "terrace",
    "terraza", "terrassa", "beach", "playa", "garden", "jardin", "sky",
    "teatre", "teatro", "theatre", "studio", "mansion", "social", "pool",
    "carrer", "calle", "plaza", "placa", "avinguda", "avenida", "passeig",
    "paseo", "rambla", "ramblas", "llobregat", "montjuic", "vila", "prat",
    "catalunya", "pier", "port", "mar", "costa", "azul",
    "barceloneta", "beer", "bodega", "cafeteria", "cala", "casa", "cerveceria",
    "city", "entre", "frankfurt", "garage", "gaudi", "gracia", "gran", "granja",
    "hermanos", "irish", "jordi", "petit", "poblenou", "raco", "rincon", "rosa",
    "rose", "sant", "sants", "shisha", "tapas", "tavern", "taverna", "vermut",
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]", " ", s.lower())).strip()


def words(s: str) -> set[str]:
    """Meaningful words: long enough to identify, not a generic descriptor."""
    return {w for w in norm(s).split(" ") if len(w) > 3 and w not in GENERIC}


class VenueLinker:
    # A word carried by this many different clubs identifies none of them.
    CORPUS_DF = 3

    def __init__(self, clubs: list[dict], db_path: pathlib.Path | None = None):
        self.clubs = [c for c in clubs if c.get("name")]

        # The curated GENERIC list is static and always trails the data. Derive
        # the rest from the corpus itself: any word appearing in CORPUS_DF+
        # different club names is a descriptor, not a name. This is what stops
        # "Nova Jazz Cava" being linked to "Jazz Sí Club" — "jazz" sits in three
        # club names, so it carries no identity, and nothing hand-maintained had
        # to know that in advance.
        df: dict[str, int] = {}
        for c in clubs:
            for w in {t for t in norm(c.get("name") or "").split(" ") if len(t) > 3}:
                df[w] = df.get(w, 0) + 1
        self.derived_generic = {w for w, n in df.items() if n >= self.CORPUS_DF}
        self.generic = GENERIC | self.derived_generic

        self.by_norm: dict[str, list[dict]] = {}
        self.indexed: list[tuple[dict, set[str]]] = []
        for c in self.clubs:
            self.by_norm.setdefault(norm(c["name"]), []).append(c)
            self.indexed.append((c, self._words(c["name"])))
        self.db = self._open(db_path or ALIAS_DB)
        self.residue: dict[str, str] = {}      # venue_norm -> raw name
        self.stats: dict[str, int] = {}

    def _words(self, s: str) -> set[str]:
        """Meaningful words, minus both the curated and corpus-derived generics."""
        return {w for w in norm(s).split(" ") if len(w) > 3 and w not in self.generic}

    # ── Alias store ──────────────────────────────────────────────────────────

    def _open(self, path: pathlib.Path) -> sqlite3.Connection:
        path.parent.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(path)
        c.execute("""CREATE TABLE IF NOT EXISTS venue_aliases (
            venue_norm TEXT PRIMARY KEY,
            venue_raw  TEXT,
            club_id    TEXT,          -- NULL = decided NOT one of ours
            club_name  TEXT,
            method     TEXT,
            city       TEXT,
            decided_at TEXT,
            hits       INTEGER DEFAULT 0
        )""")
        c.commit()
        return c

    def _alias(self, key: str) -> tuple[str | None, str] | None:
        row = self.db.execute(
            "SELECT club_id, method FROM venue_aliases WHERE venue_norm=?", (key,)
        ).fetchone()
        if not row:
            return None
        self.db.execute("UPDATE venue_aliases SET hits=hits+1 WHERE venue_norm=?", (key,))
        return (row[0], row[1])

    def learn(self, key: str, raw: str, club_id: str | None,
              club_name: str | None, method: str, city: str | None) -> None:
        """Record a decision so the deterministic pass makes it next time.

        Negative decisions (club_id None) are stored too — that is what stops
        the model being asked about the same Ibiza venue every single night.
        """
        self.db.execute(
            "INSERT INTO venue_aliases (venue_norm, venue_raw, club_id, club_name,"
            " method, city, decided_at, hits) VALUES (?,?,?,?,?,?,?,0)"
            " ON CONFLICT(venue_norm) DO UPDATE SET club_id=excluded.club_id,"
            " club_name=excluded.club_name, method=excluded.method,"
            " decided_at=excluded.decided_at",
            (key, raw, club_id, club_name, method, city,
             dt.datetime.now().isoformat(timespec="seconds")))
        self.db.commit()

    # ── Deterministic tiers ──────────────────────────────────────────────────

    @staticmethod
    def _pick(pool: list[dict]) -> dict | None:
        """Prefer active clubs; refuse to guess when several remain."""
        active = [c for c in pool if c.get("is_active")] or pool
        return active[0] if len({c["id"] for c in active}) == 1 else None

    def _deterministic(self, venue: str) -> tuple[dict | None, str | None]:
        n, w = norm(venue), self._words(venue)
        if not n:
            return None, None

        if n in self.by_norm:
            if (hit := self._pick(self.by_norm[n])):
                return hit, "exact"

        # Containment — "Moog Club" vs "Moog", "Noxe Barcelona" vs "Noxe".
        # Guarded on a meaningful word in common so a bare generic substring
        # ("Bar") cannot drag in an unrelated venue.
        if w:
            hits = [c for c, cw in self.indexed
                    if cw & w and (n in norm(c["name"]) or norm(c["name"]) in n)]
            if hits and (hit := self._pick(hits)):
                return hit, "contains"

            # Subset — every meaningful word of one side appears in the other.
            hits = [c for c, cw in self.indexed if cw and (w <= cw or cw <= w)]
            if hits and (hit := self._pick(hits)):
                return hit, "subset"

            # A single shared word, when it is a whole side's identity.
            hits = [c for c, cw in self.indexed
                    if len(cw & w) == 1 and (len(cw) == 1 or len(w) == 1)]
            if hits and (hit := self._pick(hits)):
                return hit, "shared"

        return None, None

    def resolve(self, venue: str, city: str | None = None) -> tuple[str | None, str | None]:
        """(club_id, method). club_id None means unresolved OR decided-not-ours."""
        key = norm(venue)
        if not key:
            return None, None

        if (cached := self._alias(key)) is not None:
            self._bump("alias:" + cached[1])
            return cached[0], cached[1]

        club, method = self._deterministic(venue)
        if club:
            self.learn(key, venue, club["id"], club["name"], method, city)
            self._bump(method)
            return club["id"], method

        # Outside the city we operate in, "not ours" is a fact, not a guess —
        # bank it without spending a model call.
        if city and norm(city) != HOME_CITY:
            self.learn(key, venue, None, None, "away", city)
            self._bump("away")
            return None, "away"

        self.residue[key] = venue
        self._bump("residue")
        return None, None

    def _bump(self, k: str) -> None:
        self.stats[k] = self.stats.get(k, 0) + 1

    # ── The model handles what the rules could not ───────────────────────────

    def _plausible(self, venue: str, club: dict) -> bool:
        """Could these be the same room, on the evidence of the names alone?

        The model cannot be trusted to answer this. Asked to place
        "Sunseabar Beach Club" it returned "El Kabron Beach Club" at 1.00
        confidence, and "Ku Barcelona" as "Twenties Barcelona" at 1.00 — both
        wrong, both asserted as certainties, and a self-reported confidence
        gate lets them straight through. So the model never gets to invent a
        link: it may only choose among names that already share hard evidence
        with the venue, or reject them all.

        Hard evidence is one meaningful word in common, or one normalised name
        containing the other ("m7 club" ⊂ "m7 club barcelona"). Both of the
        wrong answers above fail this; the right one passes.
        """
        n, cn = norm(venue), norm(club["name"])
        if not n or not cn:
            return False
        if n in cn or cn in n:
            return True
        # A bare overlap is not enough. "TBA - Secret Villa" and "Secret tapes"
        # share "secret" and are different places; the model linked them at 1.00
        # confidence. Demand that the shared words account for one side's whole
        # identity, which containment-style aliases satisfy and coincidental
        # word-sharing does not.
        wv, wc = self._words(venue), self._words(club["name"])
        shared = wv & wc
        if not shared:
            return False
        return wv <= shared or wc <= shared

    def _candidates(self, venue: str, limit: int = 12) -> list[dict]:
        """Clubs worth showing the model. Only plausible ones — see _plausible.
        Ranked by shared meaningful words, then substring overlap."""
        w, n = self._words(venue), norm(venue)
        scored = []
        for c, cw in self.indexed:
            if not self._plausible(venue, c):
                continue
            score = len(cw & w) * 10
            cn = norm(c["name"])
            if cn and (cn in n or n in cn):
                score += 5
            for tok in n.split():
                if len(tok) > 3 and tok in cn:
                    score += 1
            scored.append((score, c))
        scored.sort(key=lambda t: -t[0])
        return [c for _, c in scored[:limit]]

    def _warm(self) -> None:
        """Load the model before the real questions start.

        Ollama pages ~5GB off disk on the first request, which reliably blew the
        per-call timeout — every run lost its first venue (always a different
        one) to a cold start rather than to anything about the name.
        """
        body = json.dumps({"model": MODEL, "prompt": "ok", "stream": False,
                           "options": {"num_predict": 1}}).encode()
        req = urllib.request.Request(
            OLLAMA, data=body, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=300):
                log.info("  model warm")
        except Exception as e:
            log.warning("  model warm-up failed (%s) — continuing", e)

    def _ask(self, venue: str, city: str | None, cands: list[dict]) -> dict | None:
        listing = "\n".join(f"{i+1}. {c['name']}" for i, c in enumerate(cands))
        prompt = f"""You match nightlife venue names to a database of clubs in Barcelona.

A promoter wrote this venue name on an event listing:
  "{venue}"{f' (city: {city})' if city else ''}

Here are the clubs in our database that might be the same place:
{listing}

Which numbered club is THE SAME PHYSICAL VENUE as "{venue}"?

Rules:
- The same room is often written differently: "Moog Club" = "Moog",
  "City Hall" = "Disco City Hall", "Opium Barcelona" = "Opium Barcelona Restaurant and Club".
- A hotel and its rooftop bar ARE the same venue.
- Different venues that merely share a common word are NOT the same:
  "Fira Barcelona" (the expo centre) is NOT "La Fira" (a bar).
- If none of them is the same venue, answer 0. Answering 0 is correct and
  expected — many venues are simply not in our database.

Reply with ONLY compact JSON, no prose:
{{"choice": <number 0-{len(cands)}>, "confidence": <0.0-1.0>, "why": "<8 words max>"}}"""
        body = json.dumps({
            "model": MODEL, "prompt": prompt, "stream": False,
            "options": {"temperature": 0, "num_predict": 120},
        }).encode()
        req = urllib.request.Request(
            OLLAMA, data=body, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = json.loads(r.read()).get("response", "")
        except Exception as e:
            log.warning("  model call failed for %r: %s", venue, e)
            return None
        m = re.search(r"\{.*\}", raw, re.S)
        if not m:
            return None
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return None

    def resolve_residue(self, min_confidence: float = 0.0) -> dict[str, int]:
        """Ask the model about every venue the rules could not place, and turn
        each answer into a rule. Returns {linked, not_ours, skipped}.

        `min_confidence` is retained for callers but is NOT the safety
        mechanism — see _plausible. The model's own confidence is ignored
        because it does not track correctness.
        """
        out = {"linked": 0, "not_ours": 0, "skipped": 0}
        if not self.residue:
            return out
        log.info("model pass: %d unresolved venue names", len(self.residue))
        self._warm()

        for key, raw in list(self.residue.items()):
            cands = self._candidates(raw)
            if not cands:
                # Nothing even close — that is itself a decision worth keeping.
                self.learn(key, raw, None, None, "llm-none", None)
                out["not_ours"] += 1
                continue

            ans = self._ask(raw, None, cands)
            if not ans:
                out["skipped"] += 1
                continue

            choice = ans.get("choice")
            conf = float(ans.get("confidence") or 0)
            why = str(ans.get("why") or "")[:60]

            if not isinstance(choice, int) or choice < 0 or choice > len(cands):
                out["skipped"] += 1
                continue

            if choice == 0:
                self.learn(key, raw, None, None, "llm-none", None)
                out["not_ours"] += 1
                log.info("   %-34s → not ours (%.2f) %s", raw[:34], conf, why)
                continue

            club = cands[choice - 1]

            # Re-check the pick rather than trusting the score it gave itself —
            # this model reports 1.00 for wrong answers as readily as right
            # ones. Candidates are pre-filtered, so this only catches an
            # out-of-range or hallucinated index.
            if not self._plausible(raw, club):
                out["skipped"] += 1
                log.info("   %-34s → rejected implausible pick %r",
                         raw[:34], club["name"][:28])
                continue
            self.learn(key, raw, club["id"], club["name"], "llm", None)
            out["linked"] += 1
            log.info("   %-34s → %s (%.2f) %s", raw[:34], club["name"][:28], conf, why)

        self.residue.clear()
        return out

    # ── Reporting ────────────────────────────────────────────────────────────

    def report(self) -> None:
        if self.stats:
            log.info("linking: %s", "  ".join(
                f"{k}={v}" for k, v in sorted(self.stats.items(), key=lambda t: -t[1])))
        row = self.db.execute(
            "SELECT COUNT(*), SUM(club_id IS NOT NULL) FROM venue_aliases").fetchone()
        log.info("alias store: %d rules (%d linked, %d known-not-ours)",
                 row[0] or 0, row[1] or 0, (row[0] or 0) - (row[1] or 0))
