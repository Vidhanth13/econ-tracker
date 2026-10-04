"""
Load BLS CES (survey "ce") national flat files into econ_data :: ces schema.

Scope: ALL series (employment levels, hours, earnings), every industry,
SA + NSA, full history (1939-). Backfill is idempotent (truncate + reload).

Flat files: https://download.bls.gov/pub/time.series/ce/  (needs a real UA).
The combined ce.data.0.AllCESSeries is ~351MB, so we load the smaller
per-sector data files instead (a=Employment, b=AllEmployee H&E,
c=ProductionEmployee H&E) and skip the mega-file; a (series,year,period)
dedup set covers any overlap. Loads via psql \\copy from cleaned temp TSVs.
Mirrors load_jolts.py; CES has supersector/industry/datatype dimensions.
"""
import os, re, tempfile, subprocess, urllib.request

BASE = "https://download.bls.gov/pub/time.series/ce/"
UA   = "Mozilla/5.0 (econ_data ingest; vbheemsan1@gmail.com)"
PSQL = r"C:/PostgreSQL/bin/psql.exe"
DB   = "econ_data"
USER = "jarvis"
import _env  # loads PGPASSWORD (+ BEA_API_KEY) from ingest/.env (git-ignored)

TMP = tempfile.mkdtemp(prefix="ce_")

def fetch(name):
    req = urllib.request.Request(BASE + name, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=300).read().decode("utf-8", "replace")

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
    s = str(v).replace("\\", " ").replace("\t", " ").replace("\n", " ").replace("\r", " ")
    return s

def w(path, records):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for rec in records:
            f.write("\t".join(_cell(v) for v in rec) + "\n")
    return path

def I(v):
    try: return int(v)
    except: return None

def copy(table, cols, path):
    cmd = f"\\copy {table} ({cols}) FROM '{path}' WITH (FORMAT text, NULL '\\N')"
    r = subprocess.run([PSQL, "-U", USER, "-h", "localhost", "-p", "5432",
                        "-d", DB, "-c", cmd], capture_output=True, text=True)
    print(f"  {table}: {r.stdout.strip() or r.stderr.strip()}")

def sql(stmt):
    subprocess.run([PSQL, "-U", USER, "-h", "localhost", "-p", "5432",
                    "-d", DB, "-c", stmt], capture_output=True, text=True)

print("Truncating ces tables...")
sql("TRUNCATE ces.observation, ces.series, ces.datatype, ces.supersector, "
    "ces.industry RESTART IDENTITY CASCADE;")

# --- dimensions -------------------------------------------------------------
def load_dim(table, fname, cols):
    print(f"Loading {fname} ...")
    recs = [tuple(r[c] for c in cols) for r in rows(fetch(fname))]
    copy(f"ces.{table}", ",".join(cols), w(f"{TMP}/{table}.tsv", recs))

load_dim("datatype", "ce.datatype",
         ["data_type_code", "data_type_text"])
load_dim("supersector", "ce.supersector",
         ["supersector_code", "supersector_name"])
load_dim("industry", "ce.industry",
         ["industry_code", "naics_code", "publishing_status",
          "display_level", "selectable", "sort_sequence", "industry_name"])

# --- series -----------------------------------------------------------------
print("Loading ce.series ...")
keep = set()
srecs = []
for r in rows(fetch("ce.series")):
    sid = r["series_id"].strip()
    keep.add(sid)
    srecs.append((sid, r["supersector_code"], r["industry_code"],
                  r["data_type_code"], r["seasonal"],
                  r.get("series_title") or None, r.get("footnote_codes") or None,
                  I(r.get("begin_year")), r.get("begin_period"),
                  I(r.get("end_year")), r.get("end_period")))
copy("ces.series",
     "series_id,supersector_code,industry_code,data_type_code,seasonal,"
     "series_title,footnote_codes,begin_year,begin_period,end_year,end_period",
     w(f"{TMP}/series.tsv", srecs))
print(f"  kept {len(keep)} series")

# --- observations -----------------------------------------------------------
print("Discovering data files ...")
listing = fetch("")
datafiles = sorted(set(re.findall(r'(ce\.data\.[^"<> ]+)', listing)))
# skip the 351MB combined mega-file (per-sector files cover everything) + .Current
datafiles = [d for d in datafiles
             if d != "ce.data.0.AllCESSeries" and not d.endswith(".Current")]
print(f"  {len(datafiles)} data files")

obs = []
seen = set()
for df in datafiles:
    n = 0
    for r in rows(fetch(df)):
        sid = r["series_id"].strip()
        if sid not in keep:
            continue
        key = (sid, r["year"].strip(), r["period"].strip())
        if key in seen:
            continue
        seen.add(key)
        val = r["value"].strip()
        obs.append((sid, I(r["year"]), r["period"].strip(),
                    None if val in ("", "-") else val,
                    r.get("footnote_codes") or None))
        n += 1
    print(f"  {df}: +{n} rows (running total {len(obs)})")

copy("ces.observation", "series_id,year,period,value,footnote_codes",
     w(f"{TMP}/obs.tsv", obs))

print("Done. Temp dir:", TMP)
