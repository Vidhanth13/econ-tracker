"""
Load BLS PPI (survey "wp") flat files into econ_data :: ppi schema.

Scope: ALL commodity groups + Final Demand-Intermediate Demand, seasonally
adjusted + unadjusted, FULL history. PPI is US-level only (no area dimension).
Backfill is idempotent (truncate + reload).

Flat files: https://download.bls.gov/pub/time.series/wp/  (needs a real UA).
Loads via psql \\copy from cleaned temp TSVs (no psycopg dependency).
Mirrors load_cpi.py; group replaces area, item is (group_code, item_code).
"""
import os, re, tempfile, subprocess, urllib.request

BASE = "https://download.bls.gov/pub/time.series/wp/"
UA   = "Mozilla/5.0 (econ_data ingest; vbheemsan1@gmail.com)"
PSQL = r"C:/PostgreSQL/bin/psql.exe"
DB   = "econ_data"
USER = "jarvis"
import _env  # loads PGPASSWORD (+ BEA_API_KEY) from ingest/.env (git-ignored)

TMP = tempfile.mkdtemp(prefix="ppi_")

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

print("Truncating ppi tables...")
sql("TRUNCATE ppi.observation, ppi.series, ppi.item, ppi.group RESTART IDENTITY CASCADE;")

# --- group ------------------------------------------------------------------
print("Loading wp.group ...")
groups = [(r["group_code"], r["group_name"]) for r in rows(fetch("wp.group"))]
copy("ppi.group", "group_code,group_name", w(f"{TMP}/group.tsv", groups))

# --- item -------------------------------------------------------------------
print("Loading wp.item ...")
seen_item = set()
items = []
for r in rows(fetch("wp.item")):
    key = (r["group_code"], r["item_code"])
    if key in seen_item:            # dedup guard (composite PK)
        continue
    seen_item.add(key)
    items.append((r["group_code"], r["item_code"], r["item_name"]))
copy("ppi.item", "group_code,item_code,item_name", w(f"{TMP}/item.tsv", items))

# --- series (keep all; PPI is US-level) -------------------------------------
print("Loading wp.series ...")
keep = set()
srecs = []
for r in rows(fetch("wp.series")):
    sid = r["series_id"].strip()
    keep.add(sid)
    srecs.append((sid, r["group_code"], r["item_code"], r["seasonal"],
                  r.get("base_date"), r.get("series_title"), r.get("footnote_codes") or None,
                  I(r.get("begin_year")), r.get("begin_period"),
                  I(r.get("end_year")), r.get("end_period")))
copy("ppi.series",
     "series_id,group_code,item_code,seasonal,base_date,series_title,footnote_codes,"
     "begin_year,begin_period,end_year,end_period",
     w(f"{TMP}/series.tsv", srecs))
print(f"  kept {len(keep)} series")

# --- observations (all history, filtered to kept series) --------------------
print("Discovering data files ...")
listing = fetch("")
# BLS data-file names contain hyphens (e.g. wp.data.11a.Metals10-103), so parse
# the real hrefs rather than a \w-only token.
datafiles = sorted(set(re.findall(r'/wp/(wp\.data\.[^"<]+)"', listing)))
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

copy("ppi.observation", "series_id,year,period,value,footnote_codes",
     w(f"{TMP}/obs.tsv", obs))

print("Done. Temp dir:", TMP)
