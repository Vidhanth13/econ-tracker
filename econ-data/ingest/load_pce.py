"""
Load BEA PCE into econ_data :: pce  (both measures).

Source: BEA JSON API, datasetname=NIPA, Frequency=M, Year=ALL:
  Table 2.8.5 (T20805) = current-dollar spending   -> measure 'D'
  Table 2.8.4 (T20804) = Fisher price index        -> measure 'P'
Both share an identical 31-line structure (same LineNumber + description); we
key pce.line on line_number and carry each measure's SeriesCode.

Needs a BEA UserID key -> read from ingest/.env (BEA_API_KEY=...), never committed.
Idempotent: applies the schema, truncates, reloads via psql \\copy temp TSVs.
"""
import os, json, tempfile, subprocess, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
PSQL = r"C:/PostgreSQL/bin/psql.exe"
DB   = "econ_data"
USER = "jarvis"
import _env  # loads PGPASSWORD (+ BEA_API_KEY) from ingest/.env (git-ignored)
SCHEMA_SQL = os.path.join(HERE, "..", "db", "05_pce_schema.sql")


def bea_key():
    for ln in open(os.path.join(HERE, ".env"), encoding="utf-8"):
        ln = ln.strip()
        if ln.startswith("BEA_API_KEY="):
            return ln.split("=", 1)[1].strip()
    raise SystemExit("BEA_API_KEY not found in ingest/.env")


# line_number -> (display_level, parent_line, is_addendum). Shared by both tables.
HIER = {
    1:  (0, None, False),   # Personal consumption expenditures (PCE)
    2:  (1, 1,    False),   #  Goods
    3:  (2, 2,    False),   #   Durable goods
    4:  (3, 3,    False),   #    Motor vehicles and parts
    5:  (3, 3,    False),   #    Furnishings and durable household equipment
    6:  (3, 3,    False),   #    Recreational goods and vehicles
    7:  (3, 3,    False),   #    Other durable goods
    8:  (2, 2,    False),   #   Nondurable goods
    9:  (3, 8,    False),   #    Food and beverages off-premises
    10: (3, 8,    False),   #    Clothing and footwear
    11: (3, 8,    False),   #    Gasoline and other energy goods
    12: (3, 8,    False),   #    Other nondurable goods
    13: (1, 1,    False),   #  Services
    14: (2, 13,   False),   #   Household consumption expenditures (services)
    15: (3, 14,   False),   #    Housing and utilities
    16: (3, 14,   False),   #    Health care
    17: (3, 14,   False),   #    Transportation services
    18: (3, 14,   False),   #    Recreation services
    19: (3, 14,   False),   #    Food services and accommodations
    20: (3, 14,   False),   #    Financial services and insurance
    21: (3, 14,   False),   #    Other services
    22: (2, 13,   False),   #   Final consumption exp of NPISHs
    23: (3, 22,   False),   #    Gross output of nonprofit institutions
    24: (3, 22,   False),   #    Less: receipts from sales
    # --- addenda (standalone aggregates) ---
    25: (0, None, True),    # PCE excluding food and energy (CORE)
    26: (0, None, True),    # PCE excluding food, energy, and housing
    27: (0, None, True),    # Energy goods and services
    28: (0, None, True),    # PCE services excluding energy and housing (SUPERCORE)
    29: (0, None, True),    # Housing
    30: (0, None, True),    # Market-based PCE
    31: (0, None, True),    # Market-based PCE excluding food and energy
}


def fetch(table):
    q = urllib.parse.urlencode({
        "UserID": bea_key(), "method": "GetData", "datasetname": "NIPA",
        "TableName": table, "Frequency": "M", "Year": "ALL", "ResultFormat": "JSON"})
    url = "https://apps.bea.gov/api/data?&" + q
    req = urllib.request.Request(url, headers={"User-Agent": "econ_data ingest"})
    d = json.loads(urllib.request.urlopen(req, timeout=120).read().decode("utf-8", "replace"))
    res = d["BEAAPI"]["Results"]
    if "Data" not in res:
        raise SystemExit(f"BEA error for {table}: {json.dumps(d['BEAAPI'])[:400]}")
    return res["Data"]


def num(v):
    if v is None:
        return "\\N"
    s = str(v).replace(",", "").strip()
    try:
        float(s); return s
    except ValueError:
        return "\\N"


def cell(v):
    if v is None:
        return "\\N"
    return str(v).replace("\\", " ").replace("\t", " ").replace("\n", " ").replace("\r", " ")


def write_tsv(path, records):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for rec in records:
            f.write("\t".join(cell(v) for v in rec) + "\n")


def psql(args):
    return subprocess.run([PSQL, "-U", USER, "-h", "localhost", "-p", "5432", "-d", DB] + args,
                          capture_output=True, text=True)


def copy(table, cols, path):
    r = psql(["-c", f"\\copy {table} ({cols}) FROM '{path}' WITH (FORMAT text, NULL '\\N')"])
    if r.returncode:
        raise SystemExit(f"\\copy {table} failed: {r.stderr}")
    print(f"  copied -> {table}: {r.stdout.strip()}")


def obs_rows(data, measure):
    out = []
    for row in data:
        tp = row["TimePeriod"]
        if "M" not in tp:
            continue
        y, m = tp.split("M")
        out.append((int(row["LineNumber"]), measure, int(y), f"M{int(m):02d}", num(row["DataValue"])))
    return out


def main():
    spend = fetch("T20805")    # dollars
    price = fetch("T20804")    # price index
    print(f"BEA: {len(spend)} spend rows, {len(price)} price rows")

    # line dimension: line_number -> text + both series codes (from first-seen rows)
    lines = {}
    for row in spend:
        ln = int(row["LineNumber"])
        lines.setdefault(ln, {"line_text": row["LineDescription"], "spend_code": None, "price_code": None})
        lines[ln]["spend_code"] = row["SeriesCode"]
    for row in price:
        ln = int(row["LineNumber"])
        lines.setdefault(ln, {"line_text": row["LineDescription"], "spend_code": None, "price_code": None})
        lines[ln]["price_code"] = row["SeriesCode"]

    line_rows = []
    for ln in sorted(lines):
        lvl, parent, add = HIER.get(ln, (0, None, True))
        m = lines[ln]
        line_rows.append((ln, m["line_text"], m["spend_code"], m["price_code"], lvl, parent, add))

    observations = obs_rows(spend, "D") + obs_rows(price, "P")
    print(f"  {len(line_rows)} lines, {len(observations)} observations (D+P)")

    r = psql(["-f", SCHEMA_SQL])
    if r.returncode:
        raise SystemExit(f"schema apply failed: {r.stderr}")

    tmp = tempfile.mkdtemp(prefix="pce_")
    lp = os.path.join(tmp, "line.tsv"); write_tsv(lp, line_rows)
    op = os.path.join(tmp, "obs.tsv");  write_tsv(op, observations)

    psql(["-c", "TRUNCATE pce.observation, pce.line CASCADE;"])
    copy("pce.line", "line_number,line_text,spend_code,price_code,display_level,parent_line,is_addendum", lp)
    copy("pce.observation", "line_number,measure,year,period,value", op)

    r = psql(["-c",
        "SELECT measure, min(year) a, max(year) b, count(*) n FROM pce.observation GROUP BY measure ORDER BY measure;"])
    print(r.stdout.strip())
    print("Done.")


if __name__ == "__main__":
    main()
