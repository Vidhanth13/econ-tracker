"""
Import the latest NFP (CES) report as soon as BLS publishes it to the flat
files, then print an actual-vs-consensus summary. Built for release day.

BLS puts the Employment Situation press release out at 08:30 ET, but the
time.series flat files (what load_ces.py reads) can lag by minutes to ~1h.
So this polls a small headline file until the target month appears, then runs
the full idempotent reload. Dashboard picks it up on refresh (endpoints read
the DB live — no backend restart needed).

Usage:  python ingest/import_latest.py [YYYY-MM] [--once]
  target month defaults to the month we EXPECT next (one after what's in DB).
"""
import os, re, sys, time, subprocess, urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8")   # Windows console defaults to cp1252
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "https://download.bls.gov/pub/time.series/ce/"
HEAD_FILE = "ce.data.00a.TotalNonfarm.Employment"   # small; contains CES0000000001
UA   = "Mozilla/5.0 (econ_data ingest; vbheemsan1@gmail.com)"
PSQL = r"C:/PostgreSQL/bin/psql.exe"
DB, USER = "econ_data", "jarvis"
import _env  # loads PGPASSWORD (+ BEA_API_KEY) from ingest/.env (git-ignored)

HEADLINE = "CES0000000001"      # total nonfarm, all employees, SA
EARN     = "CES0500000003"      # total private, avg hourly earnings, SA

# September 2026 consensus (desk medians) — for the actual-vs-expected line
CONS = {"jobs": "~85-90k", "ue": "4.1%", "ahe_mom": "+0.3%", "ahe_yoy": "+3.1%"}

RETRIES = 150         # poll attempts
WAIT    = 20          # seconds between attempts (150 × 20s ≈ 50min of cover)


def fetch(name, timeout=120):
    req = urllib.request.Request(BASE + name, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")

def psql(sql):
    r = subprocess.run([PSQL, "-U", USER, "-h", "localhost", "-p", "5432",
                        "-d", DB, "-t", "-A", "-F", "|", "-c", sql],
                       capture_output=True, text=True)
    return r.stdout.strip()

def ord_of(ym):
    y, m = ym.split("-"); return int(y) * 12 + int(m)

def db_latest():
    """Latest YYYY-MM for the headline series currently in the DB."""
    row = psql(f"SELECT year, period FROM ces.observation WHERE series_id='{HEADLINE}' "
               f"AND period BETWEEN 'M01' AND 'M12' AND value IS NOT NULL "
               f"ORDER BY year DESC, period DESC LIMIT 1;")
    if not row:
        return None
    y, p = row.split("|"); return f"{int(y)}-{int(p[1:]):02d}"

def file_latest():
    """Latest YYYY-MM present in the BLS flat file for the headline series."""
    best = None
    for ln in fetch(HEAD_FILE).splitlines()[1:]:
        c = ln.split("\t")
        if len(c) < 4 or c[0].strip() != HEADLINE:
            continue
        per = c[2].strip()
        if not (per >= "M01" and per <= "M12"):
            continue
        ym = f"{int(c[1]):04d}-{int(per[1:]):02d}"
        if best is None or ord_of(ym) > ord_of(best):
            best = ym
    return best

def report(target):
    def grab(sid):
        r = psql(f"SELECT year, period, value, mom_chg, yoy_chg, mom_pct, yoy_pct "
                 f"FROM ces.v_report WHERE series_id='{sid}' "
                 f"ORDER BY year DESC, period DESC LIMIT 1;")
        return r.split("|") if r else None
    h, e = grab(HEADLINE), grab(EARN)
    lines = [f"✅ NFP imported — {target}"]
    if h:
        jobs = float(h[3]) if h[3] else 0
        lines.append(f"Nonfarm payrolls: {'+' if jobs>=0 else ''}{jobs:.0f}k jobs "
                     f"(consensus {CONS['jobs']}) · level {float(h[2])/1000:.1f}M")
    if e:
        lines.append(f"Avg hourly earnings: {('+' if float(e[5])>=0 else '')}{float(e[5]):.1f}% MoM "
                     f"(cons {CONS['ahe_mom']}) · {('+' if float(e[6])>=0 else '')}{float(e[6]):.1f}% YoY (cons {CONS['ahe_yoy']})")
    lines.append(f"(Unemployment rate is the household/CPS survey — not in CES; consensus {CONS['ue']}.)")
    lines.append("Refresh the US NFP tab to see it live.")
    return "\n".join(lines)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    once = "--once" in sys.argv
    cur = db_latest()
    target = args[0] if args else None
    if not target and cur:
        o = ord_of(cur) + 1
        target = f"{(o - 1)//12}-{((o - 1) % 12) + 1:02d}"
    print(f"DB latest={cur} · target={target}")

    attempts = 1 if once else RETRIES
    for i in range(1, attempts + 1):
        try:
            fl = file_latest()
        except Exception as ex:
            print(f"  [{i}] fetch error: {ex}")
            fl = None
        print(f"  [{i}/{attempts}] flat-file latest={fl}")
        if fl and ord_of(fl) >= ord_of(target):
            print(f"Target {target} is live in flat files — fast incremental load…")
            r = subprocess.run([sys.executable, os.path.join(HERE, "load_latest.py")],
                               capture_output=True, text=True)
            print(r.stdout[-500:] if r.stdout else r.stderr[-500:])
            print("---REPORT---")
            print(report(fl))
            return 0
        if i < attempts:
            time.sleep(WAIT)
    print(f"---REPORT---\n⏳ {target} not in BLS flat files yet after {attempts} checks. "
          f"Release is out but the time-series files haven't refreshed. Re-run import_latest.py later.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
