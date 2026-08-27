#!/usr/bin/env python3
"""Upload the investor deck to Supabase Storage at a FIXED path.

The path never changes, so https://clubfuoco.com/deck keeps working forever;
swapping the deck is just re-running this with a new file. The bucket is
PRIVATE -- the /deck route streams it with the service key, so the raw
storage URL can't be passed around or indexed.

    ./upload_deck.py <file.pdf>
"""
import json, os, subprocess, sys, time

BUCKET = "investor"
OBJECT = "deck.pdf"          # fixed -- do not version this filename
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root


def env():
    path = os.path.join(ROOT, ".env.local")
    out = {}
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def call(method, url, key, data=None, ctype=None, extra=None, data_file=None):
    """curl rather than urllib -- the python.org build on this Mac has no
    usable CA bundle, so urllib fails SSL verification against Supabase."""
    cmd = ["curl", "-sS", "-X", method, url,
           "-H", f"Authorization: Bearer {key}", "-H", f"apikey: {key}",
           "-w", "\n%{http_code}", "--max-time", "180"]
    if ctype:
        cmd += ["-H", f"Content-Type: {ctype}"]
    for k, v in (extra or {}).items():
        cmd += ["-H", f"{k}: {v}"]
    if data_file:
        cmd += ["--data-binary", f"@{data_file}"]
    elif data is not None:
        cmd += ["--data-binary", data]
    # Supabase intermittently drops the TLS session on multi-MB uploads
    # ("LibreSSL ... bad record mac"). It succeeds on a retry, so don't make
    # the caller re-run the whole script.
    last = ""
    for attempt in range(1, 4):
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0:
            out = r.stdout.rsplit("\n", 1)
            body, code = (out[0], out[1]) if len(out) == 2 else (r.stdout, "0")
            return int(code or 0), body
        last = r.stderr[:300]
        if attempt < 3:
            print(f"  transient network error, retrying ({attempt}/3)...")
            time.sleep(2 * attempt)
    return 0, last


def main():
    if len(sys.argv) < 2:
        sys.exit(f"usage: {sys.argv[0]} <deck.pdf>")
    src = sys.argv[1]
    if not os.path.exists(src):
        sys.exit(f"no such file: {src}")
    blob = open(src, "rb").read()
    if blob[:4] != b"%PDF":
        sys.exit("that file is not a PDF")

    e = env()
    base = e["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = e["SUPABASE_SERVICE_ROLE_KEY"]

    # 1. bucket (private), created once and then reused
    st, body = call("POST", f"{base}/storage/v1/bucket", key,
                    json.dumps({"name": BUCKET, "id": BUCKET,
                                "public": False}),
                    "application/json")
    if st in (200, 201):
        print(f"created private bucket '{BUCKET}'")
    elif "already exists" in body.lower() or st == 409:
        print(f"bucket '{BUCKET}' already exists - reusing")
    else:
        sys.exit(f"bucket create failed {st}: {body[:300]}")

    # 2. upsert the object at the fixed path
    st, body = call("POST", f"{base}/storage/v1/object/{BUCKET}/{OBJECT}", key,
                    None, "application/pdf",
                    # cache-control 0: the Storage CDN otherwise kept serving
                    # the previous deck for minutes after a swap
                    {"x-upsert": "true", "cache-control": "0"},
                    data_file=src)
    if st not in (200, 201):
        sys.exit(f"upload failed {st}: {body[:300]}")
    print(f"uploaded {len(blob):,} bytes -> {BUCKET}/{OBJECT}")
    print("live at https://clubfuoco.com/deck once the route is deployed")


if __name__ == "__main__":
    main()
