"""
Fast incremental CES load — upserts only RECENT months for the series the NFP
dashboard uses (headline, private, earnings/hours, and the per-supersector
employment series behind the sector breakdown). Seconds, not the 12-min full
reload. Existing history + deep-industry detail are left intact; run load_ces.py
later for a full refresh of everything.

Upsert is idempotent: re-running changes nothing unless BLS revised a value.
"""
import os, re, sys, tempfile, subprocess, urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = "https://download.bls.gov/pub/time.series/ce/"
UA   = "Mozilla/5.0 (econ_data ingest; vbheemsan1@gmail.com)"
PSQL = r"C:/PostgreSQL/bin/psql.exe"
DB, USER = "econ_data", "jarvis"
import _env  # loads PGPASSWORD (+ BEA_API_KEY) from ingest/.env (git-ignored)
SINCE_YEAR = 2024                       # upsert months from here on (covers revisions)
TMP = tempfile.mkdtemp(prefix="celatest_")


def fetch(name, timeout=120):
    req = urllib.request.Request(BASE + name, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")

def rows(text):
    lines = text.splitlines()
    hdr = [h.strip() for h in lines[0].split("\t")]
    for ln in lines[1:]:
        if not ln.strip():
            continue
        cells = [c.strip() for c in ln.split("\t")]
        cells += [""] * (len(hdr) - len(cells))
        yield dict(zip(hdr, cells))

def _cell(v):
    if v is None or v == "":
        return "\\N"
    return str(v).replace("\\", " ").replace("\t", " ").replace("\n", " ").replace("\r", " ")

def I(v):
    try: return int(v)
    except: return None

def psql(sql, capture=True):
    return subprocess.run([PSQL, "-U", USER, "-h", "localhost", "-p", "5432",
                           "-d", DB, "-c", sql], capture_output=capture, text=True)

# series already known to the DB (so we never insert an orphan observation)
keep = set(l.strip() for l in psql(
    "COPY (SELECT series_id FROM ces.series) TO STDOUT").stdout.splitlines() if l.strip())
print(f"known series: {len(keep)}")

# curated file set: every per-supersector EMPLOYMENT file (ce.data.NNa.*) +
# total-private hours & earnings (05b). Covers hero cards + sector breakdown.
listing = fetch("")
datafiles = sorted(set(re.findall(r'(ce\.data\.\d+a\.[^"<> ]+)', listing)))
datafiles = [d for d in datafiles if not d.endswith(".Current")]
datafiles += ["ce.data.05b.TotalPrivate.AllEmployeeHoursAndEarnings"]
print(f"curated files: {len(datafiles)}")

obs, seen = [], set()
for df in datafiles:
    n = 0
    try:
        text = fetch(df)
    except Exception as ex:
        print(f"  {df}: fetch error {ex}")
        continue
    for r in rows(text):
        sid = r["series_id"].strip()
        if sid not in keep:
            continue
        yr = I(r["year"])
        if yr is None or yr < SINCE_YEAR:
            continue
        key = (sid, r["year"].strip(), r["period"].strip())
        if key in seen:
            continue
        seen.add(key)
        val = r["value"].strip()
        obs.append((sid, yr, r["period"].strip(),
                    None if val in ("", "-") else val, r.get("footnote_codes") or None))
        n += 1
    print(f"  {df}: +{n}")

path = f"{TMP}/stage.tsv"
with open(path, "w", encoding="utf-8", newline="\n") as f:
    for rec in obs:
        f.write("\t".join(_cell(v) for v in rec) + "\n")
print(f"staged {len(obs)} rows")

# stage -> upsert
psql("CREATE TABLE IF NOT EXISTS ces.obs_stage (LIKE ces.observation INCLUDING DEFAULTS);")
psql("TRUNCATE ces.obs_stage;")
r = subprocess.run([PSQL, "-U", USER, "-h", "localhost", "-p", "5432", "-d", DB,
                    "-c", f"\\copy ces.obs_stage (series_id,year,period,value,footnote_codes) "
                          f"FROM '{path}' WITH (FORMAT text, NULL '\\N')"], capture_output=True, text=True)
print("  copy:", r.stdout.strip() or r.stderr.strip())
up = psql("INSERT INTO ces.observation (series_id,year,period,value,footnote_codes) "
          "SELECT series_id,year,period,value,footnote_codes FROM ces.obs_stage "
          "ON CONFLICT (series_id,year,period) DO UPDATE "
          "SET value=EXCLUDED.value, footnote_codes=EXCLUDED.footnote_codes;")
print("  upsert:", up.stdout.strip() or up.stderr.strip())
psql("DROP TABLE IF EXISTS ces.obs_stage;")
print("Done.")
