"""
Load CPI consensus/actual/previous from the TradingView economic calendar
into econ_data :: cpi.release  (Layer 2 expectations).

Pages year-by-year (the feed caps ~2000 events/query), maps each event's
period-name to the DATA month, and upserts. No key, no LLM.
"""
import json, urllib.request, subprocess, datetime as dt

PSQL = r"C:/PostgreSQL/bin/psql.exe"
DB, USER = "econ_data", "jarvis"
import os
import _env  # loads PGPASSWORD (+ BEA_API_KEY) from ingest/.env (git-ignored)

TITLE_METRIC = {
    "Inflation Rate MoM": "headline_mom",
    "Inflation Rate YoY": "headline_yoy",
    "Core Inflation Rate MoM": "core_mom",
    "Core Inflation Rate YoY": "core_yoy",
}
MONTHS = {m: i for i, m in enumerate(
    ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def fetch(d0, d1):
    """d0/d1 = ISO date strings. Feed caps ~2000 events, so keep windows small."""
    url = (f"https://economic-calendar.tradingview.com/events?"
           f"from={d0}T00:00:00.000Z&to={d1}T00:00:00.000Z&countries=US")
    req = urllib.request.Request(url, headers={
        "Origin": "https://www.tradingview.com", "User-Agent": "Mozilla/5.0"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read()).get("result", [])


def windows(start_year, end_year, months=5):
    """Yield (from, to) ISO date pairs in `months`-month steps to beat the cap."""
    cur = dt.date(start_year, 1, 1)
    end = dt.date(end_year, 12, 31)
    while cur < end:
        nxt = cur + dt.timedelta(days=months * 31)
        yield cur.isoformat(), min(nxt, end).isoformat()
        cur = nxt


def data_month(period_name, release_date):
    """period 'Sep' + release date -> (data_year, 'M09'). Handles the release lag."""
    pm = MONTHS.get(period_name)
    if not pm:
        return None
    rd = dt.date.fromisoformat(release_date[:10])
    year = rd.year if pm <= rd.month else rd.year - 1
    return year, f"M{pm:02d}"


def run(stmt):
    subprocess.run([PSQL, "-U", USER, "-h", "localhost", "-p", "5432", "-d", DB, "-c", stmt],
                   capture_output=True, text=True)


rows = {}
for span in windows(2015, 2026, months=5):
    try:
        evs = fetch(*span)
    except Exception as e:
        print("fetch fail", span, e); continue
    n = 0
    for e in evs:
        m = TITLE_METRIC.get(e.get("title", ""))
        if not m or e.get("period") is None:
            continue
        dm = data_month(e["period"], e.get("date", ""))
        if not dm:
            continue
        key = (m, dm[0], dm[1])
        rows[key] = (e.get("actual"), e.get("forecast"), e.get("previous"), e.get("date", "")[:10])
        n += 1
    print(f"{span}: {len(evs)} events, +{n} inflation rows (unique {len(rows)})")

# upsert
vals = []
for (metric, y, p), (a, f, pv, rd) in rows.items():
    def num(x): return "NULL" if x is None else str(x)
    rd_sql = "NULL" if not rd else f"'{rd}'"
    vals.append(f"('{metric}',{y},'{p}',{rd_sql},{num(a)},{num(f)},{num(pv)})")

if vals:
    run("TRUNCATE cpi.release;")
    # chunk inserts
    for i in range(0, len(vals), 200):
        chunk = ",".join(vals[i:i + 200])
        run(f"INSERT INTO cpi.release (metric,data_year,data_period,release_date,actual,forecast,previous) VALUES {chunk} "
            f"ON CONFLICT (metric,data_year,data_period) DO UPDATE SET "
            f"actual=EXCLUDED.actual, forecast=EXCLUDED.forecast, previous=EXCLUDED.previous, release_date=EXCLUDED.release_date;")
print(f"Loaded {len(vals)} release rows.")
