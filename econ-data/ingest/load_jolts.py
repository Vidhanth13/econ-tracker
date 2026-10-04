"""
Load BLS JOLTS (survey "jt") flat files into econ_data :: jolts schema.

Scope: ALL data elements (openings/hires/quits/separations/layoffs/ratio),
level + rate, every industry/state/sizeclass, SA + NSA, full history (2000-).
Backfill is idempotent (truncate + reload).

Flat files: https://download.bls.gov/pub/time.series/jt/  (needs a real UA).
Loads via psql \\copy from cleaned temp TSVs (no psycopg dependency).
Mirrors load_ppi.py; JOLTS has 6 scalar dimensions instead of group/item.
"""
import os, re, tempfile, subprocess, urllib.request

BASE = "https://download.bls.gov/pub/time.series/jt/"
UA   = "Mozilla/5.0 (econ_data ingest; vbheemsan1@gmail.com)"
PSQL = r"C:/PostgreSQL/bin/psql.exe"
DB   = "econ_data"
USER = "jarvis"
import _env  # loads PGPASSWORD (+ BEA_API_KEY) from ingest/.env (git-ignored)

TMP = tempfile.mkdtemp(prefix="jt_")

def fetch(name):
    req = urllib.request.Request(BASE + name, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=120).read().decode("utf-8", "replace")

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

print("Truncating jolts tables...")
sql("TRUNCATE jolts.observation, jolts.series, jolts.dataelement, jolts.ratelevel, "
    "jolts.industry, jolts.state, jolts.area, jolts.sizeclass RESTART IDENTITY CASCADE;")

# --- dimensions -------------------------------------------------------------
def load_dim(table, fname, cols):
    print(f"Loading {fname} ...")
    recs = [tuple(r[c] for c in cols) for r in rows(fetch(fname))]
    copy(f"jolts.{table}", ",".join(cols), w(f"{TMP}/{table}.tsv", recs))

load_dim("dataelement", "jt.dataelement",
         ["dataelement_code", "dataelement_text", "display_level", "selectable", "sort_sequence"])
load_dim("ratelevel", "jt.ratelevel",
         ["ratelevel_code", "ratelevel_text", "display_level", "selectable", "sort_sequence"])
load_dim("industry", "jt.industry",
         ["industry_code", "industry_text", "display_level", "selectable", "sort_sequence"])
load_dim("state", "jt.state",
         ["state_code", "state_text", "display_level", "selectable", "sort_sequence"])
load_dim("area", "jt.area",
         ["area_code", "area_text", "display_level", "selectable", "sort_sequence"])
load_dim("sizeclass", "jt.sizeclass",
         ["sizeclass_code", "sizeclass_text", "display_level", "selectable", "sort_sequence"])

# --- series -----------------------------------------------------------------
print("Loading jt.series ...")
keep = set()
srecs = []
for r in rows(fetch("jt.series")):
    sid = r["series_id"].strip()
    keep.add(sid)
    srecs.append((sid, r["seasonal"], r["industry_code"], r["state_code"],
                  r["area_code"], r["sizeclass_code"], r["dataelement_code"],
                  r["ratelevel_code"], r.get("footnote_codes") or None,
                  I(r.get("begin_year")), r.get("begin_period"),
                  I(r.get("end_year")), r.get("end_period")))
copy("jolts.series",
     "series_id,seasonal,industry_code,state_code,area_code,sizeclass_code,"
     "dataelement_code,ratelevel_code,footnote_codes,"
     "begin_year,begin_period,end_year,end_period",
     w(f"{TMP}/series.tsv", srecs))
print(f"  kept {len(keep)} series")

# --- observations -----------------------------------------------------------
print("Discovering data files ...")
listing = fetch("")
datafiles = sorted(set(re.findall(r'/jt/(jt\.data\.[^"<]+)', listing)))
datafiles = [d for d in datafiles if not d.endswith(".Current")]
print("  ", datafiles)

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

copy("jolts.observation", "series_id,year,period,value,footnote_codes",
     w(f"{TMP}/obs.tsv", obs))

print("Done. Temp dir:", TMP)
