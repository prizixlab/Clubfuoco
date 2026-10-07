#!/usr/bin/env python3
"""Which partner brands sell through Fourvenues, and on which channel.

DEPLOYED TO THE AGENTBOX — ~/scraper/fourvenues_channels.py. Shared by
fourvenues_all.py (what to read), fourvenues_push.py (who is switched off)
and fourvenues_nights.py (whose account owns each night).

── The standard method ──────────────────────────────────────────────────────
A brand sells through Fourvenues the way HypeList does: Fourvenues gives it a
referral channel (https://site.fourvenues.com/en/iframe/<channel>/events) and
the portal stores that channel on the brand (partner_brands.fourvenues_channel,
migration 20261006_partner_brands_fourvenues_channel.sql). Every channel set
there is read, mapped, merged into the one offers.json the app pulls, and each
night is filed under that brand's account.

Before the migration is applied the column doesn't exist; HypeList — the only
channel there was — is returned so nothing stops.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SECRETS = ROOT / "secrets" / "supabase.env"

# Pre-migration: the channel HypeList's partnership was built on.
LEGACY = {"hypelist": "clubfuoco-hype"}

COLS = "id,key,name,color,logo_url,owner_user_id,offers_hidden,is_active,created_at"


def supabase_env() -> tuple[str, str]:
    env: dict[str, str] = {}
    for line in SECRETS.read_text().splitlines():
        m = re.match(r'^([A-Z0-9_]+)\s*=\s*"?([^"\n]+)"?', line.strip())
        if m:
            env[m.group(1)] = m.group(2)
    return env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_ROLE_KEY"]


def _get(base: str, key: str, path: str) -> tuple[int, object]:
    req = urllib.request.Request(f"{base}/rest/v1/{path}",
                                 headers={"apikey": key, "Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


def brands(base: str | None = None, key: str | None = None) -> list[dict]:
    """Every brand with a Fourvenues channel, oldest first.

    Oldest first is also the tie-break when two brands list the SAME
    Fourvenues event: it is sold once, by the brand that came first, so the
    app never offers one product twice.

    Each item: {key, name, color, logo_url, owner_user_id, offers_hidden,
    channel}. Raises when Supabase can't be read at all — callers decide
    whether that stops them.
    """
    if base is None or key is None:
        base, key = supabase_env()
    st, rows = _get(base, key, f"partner_brands?select={COLS},fourvenues_channel"
                               "&fourvenues_channel=not.is.null&order=created_at.asc")
    if st == 200:
        return [{**r, "channel": r["fourvenues_channel"]} for r in rows]  # type: ignore[union-attr]
    if "fourvenues_channel" not in str(rows):
        raise RuntimeError(f"partner_brands unreadable ({st}): {rows}")
    # Migration not applied yet: the legacy HypeList channel only.
    keys = ",".join(LEGACY)
    st, rows = _get(base, key, f"partner_brands?select={COLS}&key=in.({keys})")
    if st != 200:
        raise RuntimeError(f"partner_brands unreadable ({st}): {rows}")
    return [{**r, "channel": LEGACY[r["key"]]} for r in rows]  # type: ignore[union-attr]


if __name__ == "__main__":
    for b in brands():
        print(f"{b['key']:<14} {b['channel']:<24} owner={'yes' if b.get('owner_user_id') else 'NO'} "
              f"{'OFF' if b.get('offers_hidden') else 'on'}")
