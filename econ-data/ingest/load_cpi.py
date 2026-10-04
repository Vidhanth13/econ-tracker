"""
Load BLS CPI (survey "cu") flat files into econ_data :: cpi schema.

Scope: US city average (area 0000), ALL item categories, seasonally adjusted +
unadjusted, FULL history. Backfill is idempotent (truncate + reload).

Flat files: https://download.bls.gov/pub/time.series/cu/  (needs a real UA).
Loads via psql \\copy from cleaned temp TSVs (no psycopg dependency).
"""
import io, os, re, sys, csv, tempfile, subprocess, urllib.request

BASE = "https://download.bls.gov/pub/time.series/cu/"
UA   = "Mozilla/5.0 (econ_data ingest; vbheemsan1@gmail.com)"
PSQL = r"C:/PostgreSQL/bin/psql.exe"
DB   = "econ_data"
USER = "jarvis"
AREA = "0000"                      # US city average
import _env  # loads PGPASSWORD (+ BEA_API_KEY) from ingest/.env (git-ignored)

TMP = tempfile.mkdtemp(prefix="cpi_")

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
        return "\\N"                      # psql text-format NULL sentinel
    s = str(v).replace("\\", " ").replace("\t", " ").replace("\n", " ").replace("\r", " ")
    return s

def w(path, header, records):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for rec in records:
            f.write("\t".join(_cell(v) for v in rec) + "\n")
    return path

def I(v):
    try: return int(v)
    except: return None
def B(v):
    return {"T": "t", "F": "f"}.get((v or "").strip(), None)

def copy(table, cols, path):
    cmd = f"\\copy {table} ({cols}) FROM '{path}' WITH (FORMAT text, NULL '\\N')"
    r = subprocess.run([PSQL, "-U", USER, "-h", "localhost", "-p", "5432",
                        "-d", DB, "-c", cmd], capture_output=True, text=True)
    print(f"  {table}: {r.stdout.strip() or r.stderr.strip()}")

def sql(stmt):
    subprocess.run([PSQL, "-U", USER, "-h", "localhost", "-p", "5432",
                    "-d", DB, "-c", stmt], capture_output=True, text=True)

print("Truncating cpi tables...")
sql("TRUNCATE cpi.observation, cpi.series, cpi.item, cpi.area RESTART IDENTITY CASCADE;")

# --- item -------------------------------------------------------------------
print("Loading cu.item ...")
items = [(r["item_code"], r["item_name"], I(r.get("display_level")),
          B(r.get("selectable")), I(r.get("sort_sequence"))) for r in rows(fetch("cu.item"))]
copy("cpi.item", "item_code,item_name,display_level,selectable,sort_sequence",
     w(f"{TMP}/item.tsv", None, items))

# --- area -------------------------------------------------------------------
print("Loading cu.area ...")
areas = [(r["area_code"], r["area_name"], I(r.get("display_level")),
          B(r.get("selectable")), I(r.get("sort_sequence"))) for r in rows(fetch("cu.area"))]
copy("cpi.area", "area_code,area_name,display_level,selectable,sort_sequence",
     w(f"{TMP}/area.tsv", None, areas))

# --- series (filter to US city average) -------------------------------------
print("Loading cu.series (area %s) ..." % AREA)
keep = set()
srecs = []
for r in rows(fetch("cu.series")):
    if r["area_code"].strip() != AREA:
        continue
    sid = r["series_id"].strip()
    keep.add(sid)
    srecs.append((sid, r["area_code"], r["item_code"], r["seasonal"],
                  r.get("periodicity_code"), r.get("base_code"), r.get("base_period"),
                  r.get("series_title"), I(r.get("begin_year")), r.get("begin_period"),
                  I(r.get("end_year")), r.get("end_period")))
copy("cpi.series",
     "series_id,area_code,item_code,seasonal,periodicity_code,base_code,base_period,"
     "series_title,begin_year,begin_period,end_year,end_period",
     w(f"{TMP}/series.tsv", None, srecs))
print(f"  kept {len(keep)} series for area {AREA}")

# --- observations (all history, filtered to kept series) --------------------
# Download every cu.data.* history file except the "Current" snapshot, keep rows
# whose series_id is in our area-0000 set.
print("Discovering data files ...")
listing = fetch("")
datafiles = sorted(set(re.findall(r"cu\.data\.\d+\.\w+", listing)))
datafiles = [d for d in datafiles if not d.endswith(".Current")]
print("  ", datafiles)

obs = []
seen = set()                                   # dedup: a series can appear in >1 file
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

copy("cpi.observation", "series_id,year,period,value,footnote_codes",
     w(f"{TMP}/obs.tsv", None, obs))

print("Done. Temp dir:", TMP)
