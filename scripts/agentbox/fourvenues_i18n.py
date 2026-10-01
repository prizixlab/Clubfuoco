#!/usr/bin/env python3
"""Give every Fourvenues product text an English and a Spanish version.

DEPLOYED TO THE AGENTBOX — lives at ~/scraper/fourvenues_i18n.py and runs from
cron between fourvenues_map.py and fourvenues_push.py. Redeploy:

    scp scripts/agentbox/fourvenues_i18n.py agentbox:~/scraper/fourvenues_i18n.py

Promoters write product names and descriptions however they like: Spanish
only, English only, Catalan, or both — "🇪🇸 Acceso + 1 consumición 🇬🇧 Access
+ 1 drink", "1 consumición / 1 drink". The app shows a guest ONE language
(Spanish for Spanish phones, English for everyone else), so each text gets
`<field>_i18n: {"en": …, "es": …}` next to it in offers.json:

  1. split flagged pairs (🇪🇸 / 🇬🇧 🇺🇸) and "A / B" pairs into their languages;
  2. detect the language of what's left;
  3. translate whatever is still missing with Claude — only when
     secrets/anthropic.env holds ANTHROPIC_API_KEY. Every translation is cached
     in intel/fourvenues/i18n.sqlite, so each text is sent once, ever.

Without a key, steps 1–2 still run and the app falls back to the original text
for a language nobody has written yet. Never fails the cron line: on any error
it leaves offers.json as it was and exits 0, so the push still happens.

Usage:
    ~/scraper/venv/bin/python3 ~/scraper/fourvenues_i18n.py [--no-translate]
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OFFERS = ROOT / "intel" / "fourvenues" / "offers.json"
CACHE = ROOT / "intel" / "fourvenues" / "i18n.sqlite"
KEYFILE = ROOT / "secrets" / "anthropic.env"
MODEL = "claude-haiku-4-5-20251001"
LANGS = ("en", "es")

FLAG = re.compile("([\U0001F1E6-\U0001F1FF]{2})")
FLAG_LANG = {"🇪🇸": "es", "🇲🇽": "es", "🇦🇷": "es", "🇬🇧": "en", "🇺🇸": "en", "🇮🇪": "en",
             "🇫🇷": "fr", "🇮🇹": "it", "🇩🇪": "de", "🇵🇹": "pt"}

WORDS = {
    "es": set("el la los las de del con y para hasta entrada incluye incluida incluidas copa copas consumición "
              "consumiciones válida valida después acceso por una un se sin hora horas mesa precio persona personas "
              "cualquier gratis llegada antes según aforo puerta botella cerveza cervezas refresco refrescos al "
              "pasada esa solo lista se pagará recomendamos".split()),
    "en": set("the with and for until entry includes included drink drinks valid after access ticket only any "
              "time not table price per person people free arrival before door bottle beer soft guest list of to "
              "at from all night queue".split()),
    "ca": set("amb fins les l' consumicions accés només vàlida llista entrada gratuïta per a abans després "
              "persones taula ampolla cervesa".split()),
    "it": set("dall inizio dell evento fino al con ingresso consumazione".split()),
}


def detect(text: str) -> str | None:
    """'es' / 'en' / 'ca' / 'it', or None for text with no words to judge
    ("Min. 50€", "2025", "🍒") — those read the same in every language."""
    tokens = re.findall(r"[a-záéíóúñüçàèòï']+", text.lower())
    if not tokens:
        return None
    score = {lang: sum(t in ws for t in tokens) for lang, ws in WORDS.items()}
    best = max(score, key=score.get)
    return best if score[best] > 0 else None


def split_known(text: str) -> tuple[dict[str, str], str | None]:
    """Languages we can read straight off the text, plus the text's own
    language when it's a single one. ({}, None) for language-less text."""
    out: dict[str, str] = {}
    parts = FLAG.split(text)
    if len(parts) > 1:
        # parts: [lead-in, flag, text, flag, text, …]
        for i in range(1, len(parts) - 1, 2):
            lang = FLAG_LANG.get(parts[i])
            seg = parts[i + 1].strip(" \n·|-–—:")
            if lang and seg:
                out[lang] = seg
        if out:
            return out, None
    # "1 consumición / 1 drink" — two short halves in two languages.
    halves = [h.strip() for h in re.split(r"\s+/\s+", text)]
    if len(halves) == 2 and all(halves):
        a, b = detect(halves[0]), detect(halves[1])
        if a and b and a != b:
            return {a: halves[0], b: halves[1]}, None
    lang = detect(text)
    if lang:
        out[lang] = text.strip()
    return out, lang


def api_key() -> tuple[str, str | None] | None:
    """(key, workspace id). A key not scoped to a workspace must name one in
    ANTHROPIC_WORKSPACE_ID (anthropic-workspace-id header) or every call 400s."""
    if not KEYFILE.exists():
        return None
    text = KEYFILE.read_text()
    m = re.search(r'ANTHROPIC_API_KEY\s*=\s*"?([^"\s]+)', text)
    w = re.search(r'ANTHROPIC_WORKSPACE_ID\s*=\s*"?([^"\s]+)', text)
    return (m.group(1), w.group(1) if w else None) if m else None


def translate(key: tuple[str, str | None], items: list[tuple[str, str, str]]) -> dict[str, dict[str, str]]:
    """items: (id, source_lang, text). Returns {id: {"en": …, "es": …}}."""
    prompt = (
        "Translate nightclub ticket names and descriptions for a Barcelona nightlife app. "
        "For each item return natural, short English (en) and Spanish (es). Keep prices, times, "
        "brand and event names, emoji and line breaks as they are. 'Copa' is a mixed drink "
        "('drink'), 'consumición' is a drink, 'chupito' is a shot, 'lista' is a guestlist. "
        "Reply with ONLY a JSON object mapping each id to {\"en\": ..., \"es\": ...}.\n\n"
        + json.dumps([{"id": i, "lang": lang, "text": t} for i, lang, t in items], ensure_ascii=False)
    )
    body = json.dumps({"model": MODEL, "max_tokens": 8000,
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    headers = {"x-api-key": key[0], "anthropic-version": "2023-06-01", "content-type": "application/json"}
    if key[1]:
        headers["anthropic-workspace-id"] = key[1]
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            reply = json.loads(r.read())
    except urllib.error.HTTPError as ex:
        # Surface Anthropic's own message ("not scoped to a workspace", …).
        raise RuntimeError(f"{ex.code}: {ex.read().decode()[:240]}") from None
    text = "".join(b.get("text", "") for b in reply.get("content", []))
    m = re.search(r"\{.*\}", text, re.S)
    return json.loads(m.group(0)) if m else {}


def main() -> int:
    offers = json.loads(OFFERS.read_text())
    con = sqlite3.connect(CACHE)
    con.execute("create table if not exists i18n (hash text primary key, src text, en text, es text)")
    cached = {h: {"en": en, "es": es} for h, en, es in con.execute("select hash, en, es from i18n")}

    # Every text field, as (owner dict, field name).
    fields: list[tuple[dict, str]] = []
    for e in offers.get("events", []):
        for p in e.get("products", []):
            fields += [(p, "name"), (p, "detail")]
            for r in p.get("rates") or []:
                fields += [(r, "name"), (r, "description")]

    todo: dict[str, tuple[str, str]] = {}          # hash → (lang, text) needing translation
    for owner, f in fields:
        text = owner.get(f)
        if not text:
            continue
        known, lang = split_known(text)
        if not known:
            continue                                # language-less: same for everyone
        h = hashlib.sha1(text.encode()).hexdigest()[:16]
        have = {**known, **{k: v for k, v in (cached.get(h) or {}).items() if v}}
        owner[f"{f}_i18n"] = {k: have[k] for k in LANGS if have.get(k)}
        if any(not have.get(k) for k in LANGS) and h not in cached:
            src_lang = lang or next(iter(known))
            todo[h] = (src_lang, known.get(src_lang) or text)

    key = None if "--no-translate" in sys.argv else api_key()
    translated = 0
    if todo and key:
        items = [(h, lang, t) for h, (lang, t) in todo.items()]
        for i in range(0, len(items), 40):
            batch = items[i:i + 40]
            try:
                got = translate(key, batch)
            except Exception as ex:  # noqa: BLE001 — never block the push
                print(f"i18n: translation batch failed: {ex}")
                continue
            for h, lang, t in batch:
                tr = got.get(h) or {}
                if tr.get("en") and tr.get("es"):
                    con.execute("insert or replace into i18n values (?,?,?,?)", (h, t, tr["en"], tr["es"]))
                    cached[h] = {"en": tr["en"], "es": tr["es"]}
                    translated += 1
        con.commit()
        # Second pass so this run already carries the new translations.
        for owner, f in fields:
            text = owner.get(f)
            if not text:
                continue
            h = hashlib.sha1(text.encode()).hexdigest()[:16]
            if h in cached:
                known, _ = split_known(text)
                owner[f"{f}_i18n"] = {k: (known.get(k) or cached[h][k]) for k in LANGS}

    OFFERS.write_text(json.dumps(offers, ensure_ascii=False, separators=(",", ":")))
    missing = sum(1 for h in todo if h not in cached)
    print(f"i18n: {len(todo)} texts lacked a language, {translated} translated"
          + ("" if key else " (no ANTHROPIC_API_KEY in secrets/anthropic.env — untranslated)")
          + (f", {missing} still missing" if missing else ""))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as ex:  # noqa: BLE001 — the push must still run
        print(f"i18n: skipped ({ex})")
        sys.exit(0)
