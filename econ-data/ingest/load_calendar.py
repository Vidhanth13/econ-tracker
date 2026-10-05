"""
Load the Forex Factory weekly economic calendar into econ_data :: calendar.event.

Decoupled + persistent: fetch the public FF feeds (last / this / next week),
normalise each event time to UTC, and upsert so re-runs (a) fill in `actual`
as releases print and (b) accumulate past events over time. The app never
touches the live feed — it only reads this table.

No API key. Loads via psql \\copy into a staging temp table, then upsert
(no psycopg dependency), mirroring the other ingest loaders.
"""
import _env  # loads PGPASSWORD from ingest/.env (git-ignored)
import os, csv, json, tempfile, subprocess, urllib.request
from datetime import datetime, timezone

FEEDS = [
    "https://nfs.faireconomy.media/ff_calendar_lastweek.json",
    "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
    "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
]
UA = "Mozilla/5.0 (econ_data calendar ingest; vbheemsan1@gmail.com)"
PSQL = r"C:/PostgreSQL/bin/psql.exe"
HOST, USER, DB = "localhost", "jarvis", "econ_data"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return json.loads(urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace"))


def clean(s):
    return (s or "").replace("\t", " ").replace("\n", " ").replace("\r", " ").strip()


def collect():
    seen, out = set(), []
    for url in FEEDS:
        try:
            data = fetch(url)
        except Exception as e:
            print("skip", url, e)
            continue
        for e in data:
            try:
                dt = datetime.fromisoformat(e["date"]).astimezone(timezone.utc)
            except Exception:
                continue
            c, t = clean(e.get("country")), clean(e.get("title"))
            if not t:
                continue
            key = (c, t, dt.isoformat())
            if key in seen:
                continue
            seen.add(key)
            out.append([dt.isoformat(), c, t, clean(e.get("impact")),
                        clean(e.get("forecast")), clean(e.get("previous")), clean(e.get("actual"))])
    return out


def main():
    rows = collect()
    print(f"{len(rows)} events pulled from {len(FEEDS)} feeds")
    tmp = tempfile.mkdtemp(prefix="cal_")
    tsv = os.path.join(tmp, "events.tsv").replace(os.sep, "/")
    with open(tsv, "w", encoding="utf-8", newline="") as f:
        csv.writer(f, delimiter="\t", lineterminator="\n").writerows(rows)

    sql = f"""
CREATE TEMP TABLE _stage (event_at timestamptz, country text, title text,
                          impact text, forecast text, previous text, actual text);
\\copy _stage FROM '{tsv}' WITH (FORMAT csv, DELIMITER E'\\t');
INSERT INTO calendar.event (event_at, country, title, impact, forecast, previous, actual)
SELECT event_at, country, title, impact, forecast, previous, actual FROM _stage
ON CONFLICT (country, title, event_at) DO UPDATE
   SET impact   = EXCLUDED.impact,
       forecast = EXCLUDED.forecast,
       previous = EXCLUDED.previous,
       actual   = COALESCE(EXCLUDED.actual, calendar.event.actual),
       fetched_at = now();
SELECT count(*) AS total, min(event_at) AS earliest, max(event_at) AS latest FROM calendar.event;
"""
    sqlf = os.path.join(tmp, "load.sql")
    open(sqlf, "w", encoding="utf-8").write(sql)
    r = subprocess.run([PSQL, "-h", HOST, "-U", USER, "-d", DB, "-v", "ON_ERROR_STOP=1", "-f", sqlf],
                       capture_output=True, text=True, env={**os.environ})
    print(r.stdout.strip())
    if r.returncode:
        print("ERROR:", r.stderr.strip())
        raise SystemExit(1)


if __name__ == "__main__":
    main()
