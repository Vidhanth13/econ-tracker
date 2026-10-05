"""
Econ Tracker API — read-only FastAPI over the econ_data Postgres DB.
No LLM, no external calls at request time. Pure DB -> JSON.

Convention (market standard, hard-wired): levels & MoM use SA (CUSR...),
YoY uses NSA (CUUR...). The frontend never chooses seasonal adjustment.

Two surveys share the same cockpit shape, selected via ?survey=cpi|ppi:
  cpi -> Consumer Price Index (schema cpi, series CU..0000<item>)
  ppi -> Producer Price Index, Final Demand tree (schema ppi, series WP<S|U>FD<item>)
CPI carries release consensus/surprise; PPI does not (releases not ingested).

Endpoints (all accept &survey=cpi|ppi, default cpi):
  GET /api/health
  GET /api/months                                 -> available months (SA)
  GET /api/categories                             -> category tree
  GET /api/trend?item=&from=&to=                  -> line-graph (SA index + MoM + YoY)
  GET /api/headline?item=                          -> latest print card (+ core)
  GET /api/momentum?item=&n=24                     -> MoM/YoY series + accel summary
  GET /api/drivers?month=&level=1                  -> window MoM by category
  GET /api/history?item=&n=24                      -> release history table
"""
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from db import query
import re
from datetime import datetime, timezone

app = FastAPI(title="Econ Tracker API", version="4.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# Per-survey config. `item` keys are everything AFTER the seasonal char, so
# series_id = sa_prefix + item (CPI: CUSR0000+SA0; PPI: WPS+FD4). PPI uses the
# Final Demand (group FD) tree; depth is derived from item_code length.
SURVEYS = {
    "cpi": {"schema": "cpi", "sa": "CUSR0000", "nsa": "CUUR0000",
            "headline": "SA0", "core": "SA0L1E", "has_releases": True},
    "ppi": {"schema": "ppi", "sa": "WPS", "nsa": "WPU",
            "headline": "FD4", "core": "FD49104", "has_releases": False},
}


def cfg(survey):
    return SURVEYS.get(survey, SURVEYS["cpi"])


def _ord(ym):
    y, m = ym.split("-"); return int(y) * 12 + int(m)


def _label(year, period):
    return f"{MONTHS[int(period[1:])]} {year}"


def _series(item, seasonal, survey="cpi"):
    """Monthly observations for one series, oldest->newest."""
    c = cfg(survey)
    prefix = c["sa"] if seasonal == "S" else c["nsa"]
    rows = query(
        f"""
        SELECT year, period, value
        FROM {c['schema']}.observation
        WHERE series_id = %(sid)s AND period BETWEEN 'M01' AND 'M12'
          AND value IS NOT NULL
        ORDER BY year, period
        """,
        {"sid": prefix + item},
    )
    return [{"year": r["year"], "period": r["period"],
             "value": float(r["value"]),
             "ord": r["year"] * 12 + int(r["period"][1:]),
             "ym": f"{r['year']}-{int(r['period'][1:]):02d}",
             "label": _label(r["year"], r["period"])} for r in rows]


def _releases(metric, survey="cpi"):
    """ym -> {actual, forecast, previous, release_date}. Only CPI has releases."""
    if not cfg(survey)["has_releases"]:
        return {}
    rows = query(
        "SELECT data_year, data_period, actual, forecast, previous, release_date "
        "FROM cpi.release WHERE metric=%(m)s", {"m": metric})
    out = {}
    for r in rows:
        ym = f"{r['data_year']}-{int(r['data_period'][1:]):02d}"
        out[ym] = {
            "actual": float(r["actual"]) if r["actual"] is not None else None,
            "forecast": float(r["forecast"]) if r["forecast"] is not None else None,
            "previous": float(r["previous"]) if r["previous"] is not None else None,
            "release_date": r["release_date"].isoformat() if r["release_date"] else None,
        }
    return out


def _mom(sa, i):
    return round((sa[i]["value"] / sa[i - 1]["value"] - 1) * 100, 2) if i >= 1 else None


def _yoy_from(nsa_map, s):
    prev = nsa_map.get(s["ord"] - 12)
    cur = nsa_map.get(s["ord"])
    return round((cur / prev - 1) * 100, 2) if prev and cur else None


# --- PPI classifications -----------------------------------------------------
# fd        = Final Demand tree (group FD), SA for MoM / NSA for YoY.
# commodity = commodity grouping (Fuels, Chemicals, Metals...), NSA only (deep
#             history back to the 1920s-30s), so MoM and YoY both from NSA.
COMMODITY_GROUPS = ["00", "01", "02", "03", "04", "05", "06", "07",
                    "08", "09", "10", "11", "12", "13", "14", "15"]
COMMODITY_ROOT = "00000000"   # All commodities (WPU00000000)


def _working(item, cls, survey):
    """Return (working_series, yoy_map). Working series drives level + MoM."""
    if cls == "commodity":
        w = _series(item, "U", survey)
        return w, {s["ord"]: s["value"] for s in w}
    w = _series(item, "S", survey)
    return w, {s["ord"]: s["value"] for s in _series(item, "U", survey)}


def _commodity_nodes():
    """All commodity-grouping nodes (NSA), each with a parent key, for the tree.
    key = group_code + item_code (item '-' => group total). Parent = nearest
    prefix within the same group; group totals hang off All commodities."""
    rows = query(
        """
        SELECT s.group_code, s.item_code, ('WPU' || s.group_code ||
                 CASE WHEN s.item_code='-' THEN '' ELSE s.item_code END) AS series_id,
               i.item_name
        FROM ppi.series s JOIN ppi.item i
          ON i.group_code=s.group_code AND i.item_code=s.item_code
        WHERE s.seasonal='U' AND s.group_code = ANY(%(g)s)
        ORDER BY s.group_code, s.item_code
        """,
        {"g": COMMODITY_GROUPS},
    )
    # key per node
    def keyof(g, it):
        return g + ("" if it == "-" else it)
    nodes = []
    by_group = {}
    for r in rows:
        k = keyof(r["group_code"], r["item_code"])
        node = {"item_code": k, "item_name": r["item_name"],
                "group_code": r["group_code"], "raw_item": r["item_code"]}
        nodes.append(node)
        by_group.setdefault(r["group_code"], []).append(node)
    # assign parents
    for n in nodes:
        g, it = n["group_code"], n["raw_item"]
        if n["item_code"] == COMMODITY_ROOT:
            n["parent"] = None                      # root
        elif it == "-":
            n["parent"] = COMMODITY_ROOT            # group total -> All commodities
        else:
            # nearest strict-prefix item within the same group
            best = None
            for o in by_group[g]:
                oi = o["raw_item"]
                if oi != "-" and oi != it and it.startswith(oi) and \
                   (best is None or len(oi) > len(best["raw_item"])):
                    best = o
            n["parent"] = best["item_code"] if best else keyof(g, "-")
    return nodes


@app.get("/api/health")
def health(survey: str = "cpi"):
    c = cfg(survey)
    return {"ok": True, "survey": survey,
            "observations": query(f"SELECT count(*) c FROM {c['schema']}.observation")[0]["c"]}


@app.get("/api/months")
def months(survey: str = "cpi", cls: str = "fd"):
    if survey == "ppi" and cls == "commodity":
        # All Commodities NSA — the deepest month spine (1913 -> now)
        return [{"value": s["ym"], "label": s["label"]}
                for s in _series(COMMODITY_ROOT, "U", survey)]
    return [{"value": s["ym"], "label": s["label"]}
            for s in _series(cfg(survey)["headline"], "S", survey)]


@app.get("/api/categories")
def categories(survey: str = "cpi", cls: str = "fd"):
    if survey == "ppi" and cls == "commodity":
        nodes = _commodity_nodes()
        return [{"item_code": n["item_code"], "item_name": n["item_name"],
                 "parent": n["parent"], "group_code": n["group_code"]} for n in nodes]
    if survey == "ppi":
        # Final Demand tree; depth from item_code length ("4"=0, "41"=1, ...),
        # item_code returned WITH the FD group prefix so it maps to a series id.
        return query(
            """
            SELECT ('FD' || s.item_code) AS item_code, i.item_name,
                   (length(s.item_code) - 1) AS display_level,
                   row_number() OVER (ORDER BY s.item_code) AS sort_sequence
            FROM ppi.series s
            JOIN ppi.item i ON i.group_code = s.group_code AND i.item_code = s.item_code
            WHERE s.group_code = 'FD' AND s.seasonal = 'S'
            ORDER BY s.item_code
            """
        )
    return query(
        """
        SELECT DISTINCT i.item_code, i.item_name, i.display_level, i.sort_sequence
        FROM cpi.series s JOIN cpi.item i ON i.item_code = s.item_code
        WHERE s.area_code='0000' AND s.seasonal='S'
        ORDER BY i.sort_sequence
        """
    )


@app.get("/api/trend")
def trend(item: str = None, frm: str = Query(..., alias="from"), to: str = Query(...),
          survey: str = "cpi", cls: str = "fd"):
    item = item or cfg(survey)["headline"]
    sa, nsa = _working(item, cls, survey)
    fo, tob = _ord(frm), _ord(to)
    out = []
    for i, s in enumerate(sa):
        if fo <= s["ord"] <= tob:
            out.append({"period": s["ym"], "label": s["label"], "value": s["value"],
                        "mom_pct": _mom(sa, i), "yoy_pct": _yoy_from(nsa, s)})
    return out


@app.get("/api/headline")
def headline(item: str = None, survey: str = "cpi"):
    c = cfg(survey)
    item = item or c["headline"]
    schema = c["schema"]

    def card(it):
        sa = _series(it, "S", survey)
        nsa = {s["ord"]: s["value"] for s in _series(it, "U", survey)}
        if len(sa) < 2:
            return None
        last, prev = sa[-1], sa[-2]
        if survey == "ppi":
            name = query("SELECT item_name FROM ppi.item WHERE group_code='FD' AND item_code=%(c)s",
                         {"c": it[2:]})   # strip 'FD' prefix back to item_code
        else:
            name = query("SELECT item_name FROM cpi.item WHERE item_code=%(c)s", {"c": it})
        pfx = "headline" if it == c["headline"] else "core" if it == c["core"] else None
        exp = {}
        if pfx and c["has_releases"]:
            ry = _releases(pfx + "_yoy", survey).get(last["ym"], {})
            rm = _releases(pfx + "_mom", survey).get(last["ym"], {})
            def surp(r):
                return (round(r["actual"] - r["forecast"], 2)
                        if r.get("actual") is not None and r.get("forecast") is not None else None)
            exp = {
                "cons_yoy": ry.get("forecast"), "actual_yoy": ry.get("actual"), "surprise_yoy": surp(ry),
                "cons_mom": rm.get("forecast"), "actual_mom": rm.get("actual"), "surprise_mom": surp(rm),
            }
        return {
            "item_code": it,
            "item_name": name[0]["item_name"] if name else it,
            "month": last["label"], "ym": last["ym"],
            "index": last["value"],
            "mom_pct": _mom(sa, len(sa) - 1),
            "prev_mom_pct": _mom(sa, len(sa) - 2),
            "yoy_pct": _yoy_from(nsa, last),
            "prev_yoy_pct": _yoy_from(nsa, prev),
            **exp,
        }
    return {"headline": card(item), "core": card(c["core"])}


@app.get("/api/momentum")
def momentum(item: str = None, n: int = 24, survey: str = "cpi", cls: str = "fd"):
    item = item or cfg(survey)["headline"]
    sa, nsa = _working(item, cls, survey)
    pts = []
    for i, s in enumerate(sa):
        pts.append({"ym": s["ym"], "label": s["label"],
                    "mom_pct": _mom(sa, i), "yoy_pct": _yoy_from(nsa, s)})
    tail = pts[-n:]
    # 3-month annualized SA momentum
    ann3 = None
    if len(sa) >= 4:
        f = 1.0
        for k in range(-3, 0):
            f *= sa[k]["value"] / sa[k - 1]["value"]
        ann3 = round((f ** 4 - 1) * 100, 2)
    # acceleration: latest MoM vs avg of prior 3; latest YoY vs YoY 3 months ago
    moms = [p["mom_pct"] for p in pts if p["mom_pct"] is not None]
    yoys = [p["yoy_pct"] for p in pts if p["yoy_pct"] is not None]
    accel_mom = None
    if len(moms) >= 4:
        accel_mom = round(moms[-1] - sum(moms[-4:-1]) / 3, 2)
    accel_yoy = None
    if len(yoys) >= 4:
        accel_yoy = round(yoys[-1] - yoys[-4], 2)

    # quarterly momentum: quarter-average index, QoQ % change, last 24 quarters
    qagg = {}   # (year, q) -> [values]
    for s in sa:
        q = (int(s["period"][1:]) - 1) // 3 + 1
        qagg.setdefault((s["year"], q), []).append(s["value"])
    qkeys = sorted(k for k, v in qagg.items() if len(v) == 3)   # complete quarters only
    quarters = []
    for i, k in enumerate(qkeys):
        avg = sum(qagg[k]) / 3
        prev = sum(qagg[qkeys[i - 1]]) / 3 if i >= 1 and \
            (qkeys[i - 1][0] * 4 + qkeys[i - 1][1]) == (k[0] * 4 + k[1] - 1) else None
        quarters.append({"label": f"Q{k[1]} {k[0]}", "year": k[0], "q": k[1],
                         "chg_pct": round((avg / prev - 1) * 100, 2) if prev else None})

    return {
        "series": tail,
        "quarters": quarters[-n:],
        "summary": {
            "mom_latest": moms[-1] if moms else None,
            "yoy_latest": yoys[-1] if yoys else None,
            "ann3_pct": ann3,
            "accel_mom": accel_mom,
            "accel_yoy": accel_yoy,
            "direction": ("accelerating" if (accel_yoy or 0) > 0.05
                          else "decelerating" if (accel_yoy or 0) < -0.05 else "steady"),
        },
    }


@app.get("/api/drivers")
def drivers(month: str = Query(None), level: int = Query(1), lookback: int = Query(1),
            survey: str = "cpi"):
    """What drove the print over a trailing window (SA % change), by category.
    lookback = months back from the target month (1/3/6/12). level=0 => all levels."""
    c = cfg(survey)
    lvl = None if level == 0 else level
    sa_all = _series(c["headline"], "S", survey)
    ym = month or sa_all[-1]["ym"]
    o = _ord(ym)

    def de_ord(n):  # ordinal -> (year, 'Mmm')
        return (n - 1) // 12, f"M{((n - 1) % 12) + 1:02d}"

    ty, tp = de_ord(o)                 # target (latest) month
    py, pp = de_ord(o - max(1, lookback))  # window start

    if survey == "ppi":
        ser_cte = """
            SELECT s.series_id, ('FD' || s.item_code) AS item_code, i.item_name,
                   (length(s.item_code) - 1) AS display_level
            FROM ppi.series s
            JOIN ppi.item i ON i.group_code=s.group_code AND i.item_code=s.item_code
            WHERE s.group_code='FD' AND s.seasonal='S'
              AND (%(level)s IS NULL OR (length(s.item_code) - 1)=%(level)s)
        """
        schema = "ppi"
    else:
        ser_cte = """
            SELECT s.series_id, i.item_code, i.item_name, i.display_level
            FROM cpi.series s JOIN cpi.item i ON i.item_code=s.item_code
            WHERE s.area_code='0000' AND s.seasonal='S'
              AND (%(level)s IS NULL OR i.display_level=%(level)s)
        """
        schema = "cpi"
    rows = query(
        f"""
        WITH ser AS ({ser_cte}),
        vf AS (SELECT series_id,value FROM {schema}.observation WHERE year=%(py)s AND period=%(pp)s),
        vt AS (SELECT series_id,value FROM {schema}.observation WHERE year=%(ty)s AND period=%(tp)s)
        SELECT ser.item_code, ser.item_name, ser.display_level,
               round((vt.value/NULLIF(vf.value,0)-1)*100,2) AS mom_pct
        FROM ser JOIN vf ON vf.series_id=ser.series_id JOIN vt ON vt.series_id=ser.series_id
        WHERE vf.value IS NOT NULL AND vt.value IS NOT NULL
        ORDER BY mom_pct DESC
        """,
        {"level": lvl, "py": py, "pp": pp, "ty": ty, "tp": tp},
    )
    return {"month": _label(ty, tp),
            "from_label": _label(py, pp),
            "lookback": max(1, lookback),
            "rows": [{"item_code": r["item_code"], "item_name": r["item_name"],
                      "mom_pct": float(r["mom_pct"]) if r["mom_pct"] is not None else None}
                     for r in rows]}


@app.get("/api/history")
def history(item: str = None, n: int = 24, survey: str = "cpi", cls: str = "fd"):
    c = cfg(survey)
    item = item or c["headline"]
    sa, nsa = _working(item, cls, survey)
    ryoy = _releases("headline_yoy", survey) if (cls == "fd" and item == c["headline"]) else {}
    rmom = _releases("headline_mom", survey) if (cls == "fd" and item == c["headline"]) else {}
    out = []
    for i, s in enumerate(sa):
        ry = ryoy.get(s["ym"], {})
        rm = rmom.get(s["ym"], {})
        surp = (round(ry["actual"] - ry["forecast"], 2)
                if ry.get("actual") is not None and ry.get("forecast") is not None else None)
        out.append({"ym": s["ym"], "label": s["label"], "index": s["value"],
                    "mom_pct": _mom(sa, i), "yoy_pct": _yoy_from(nsa, s),
                    "cons_yoy": ry.get("forecast"), "actual_yoy": ry.get("actual"),
                    "surprise_yoy": surp,
                    "cons_mom": rm.get("forecast"), "actual_mom": rm.get("actual")})
    return list(reversed(out[-n:]))


def _window_mom(series_ids, py, pp, ty, tp):
    """Window MoM (%) per series between (py,pp) and (ty,tp), NULLs dropped."""
    if not series_ids:
        return {}
    rows = query(
        """
        WITH vf AS (SELECT series_id,value FROM ppi.observation
                    WHERE year=%(py)s AND period=%(pp)s AND series_id = ANY(%(ids)s)),
             vt AS (SELECT series_id,value FROM ppi.observation
                    WHERE year=%(ty)s AND period=%(tp)s AND series_id = ANY(%(ids)s))
        SELECT vt.series_id, round((vt.value/NULLIF(vf.value,0)-1)*100,2) AS mom_pct
        FROM vt JOIN vf ON vf.series_id=vt.series_id
        WHERE vf.value IS NOT NULL AND vt.value IS NOT NULL
        """,
        {"ids": series_ids, "py": py, "pp": pp, "ty": ty, "tp": tp},
    )
    return {r["series_id"]: float(r["mom_pct"]) for r in rows if r["mom_pct"] is not None}


@app.get("/api/node")
def node(item: str, lookback: int = 1, survey: str = "ppi", cls: str = "fd"):
    """PPI tree drill-down: one category's latest print + its direct-children
    sub-breakdown (window MoM). fd = Final Demand tree (SA); commodity = commodity
    grouping (NSA, deep history). trend/momentum/history fetched separately."""
    sa, nsa = _working(item, cls, survey)
    if not sa:
        return {"found": False, "item_code": item, "children": []}
    last = sa[-1]
    o = last["ord"]

    def de_ord(n):
        return (n - 1) // 12, f"M{((n - 1) % 12) + 1:02d}"

    ty, tp = de_ord(o)
    py, pp = de_ord(o - max(1, lookback))

    if cls == "commodity":
        nodes = _commodity_nodes()
        me = next((n for n in nodes if n["item_code"] == item), None)
        name = me["item_name"] if me else item
        kids_meta = [n for n in nodes if n["parent"] == item]
        ids = ["WPU" + k["item_code"] for k in kids_meta]
        mom = _window_mom(ids, py, pp, ty, tp)
        kids = sorted(
            [{"item_code": k["item_code"], "item_name": k["item_name"],
              "mom_pct": mom.get("WPU" + k["item_code"])} for k in kids_meta
             if mom.get("WPU" + k["item_code"]) is not None],
            key=lambda r: r["mom_pct"], reverse=True)
    else:
        code = item[2:]                    # strip 'FD' group prefix
        nm = query("SELECT item_name FROM ppi.item WHERE group_code='FD' AND item_code=%(c)s",
                   {"c": code})
        name = nm[0]["item_name"] if nm else item
        rows = query(
            """
            WITH ch AS (
              SELECT s.series_id, ('FD' || i.item_code) AS item_code, i.item_name
              FROM ppi.series s JOIN ppi.item i ON i.group_code=s.group_code AND i.item_code=s.item_code
              WHERE s.group_code='FD' AND s.seasonal='S'
                AND i.item_code LIKE %(pfx)s AND length(i.item_code)=%(plen)s
            ),
            vf AS (SELECT series_id,value FROM ppi.observation WHERE year=%(py)s AND period=%(pp)s),
            vt AS (SELECT series_id,value FROM ppi.observation WHERE year=%(ty)s AND period=%(tp)s)
            SELECT ch.item_code, ch.item_name,
                   round((vt.value/NULLIF(vf.value,0)-1)*100,2) AS mom_pct
            FROM ch JOIN vf ON vf.series_id=ch.series_id JOIN vt ON vt.series_id=ch.series_id
            WHERE vf.value IS NOT NULL AND vt.value IS NOT NULL
            ORDER BY mom_pct DESC
            """,
            {"pfx": code + "%", "plen": len(code) + 1, "py": py, "pp": pp, "ty": ty, "tp": tp},
        )
        kids = [{"item_code": r["item_code"], "item_name": r["item_name"],
                 "mom_pct": float(r["mom_pct"]) if r["mom_pct"] is not None else None} for r in rows]

    return {
        "found": True,
        "item_code": item,
        "item_name": name,
        "month": last["label"], "ym": last["ym"], "index": last["value"],
        "mom_pct": _mom(sa, len(sa) - 1),
        "prev_mom_pct": _mom(sa, len(sa) - 2),
        "yoy_pct": _yoy_from(nsa, last),
        "prev_yoy_pct": _yoy_from(nsa, sa[-2]) if len(sa) >= 2 else None,
        "from_label": _label(py, pp), "to_label": _label(ty, tp), "lookback": max(1, lookback),
        "children": kids,
    }


# ============================================================================
# JOLTS (survey "jt") — labor-market FLOWS. Its own endpoints, not the
# price-index cockpit: the story is the rate/level and its point-change, not a
# MoM/YoY on an index base. Headline dims = Total nonfarm, US, all sizes, SA.
# Series id = JT + seasonal + industry(6) + state(2) + area(5) + sizeclass(2)
#             + dataelement(2) + ratelevel(1).
# ============================================================================
JOLTS_HEADLINES = [
    {"key": "openings",    "element": "JO", "rate": "R", "label": "Job openings",
     "unit": "rate", "blurb": "Unmet labor demand — high = tight market."},
    {"key": "hires",       "element": "HI", "rate": "R", "label": "Hires",
     "unit": "rate", "blurb": "Gross hiring pace."},
    {"key": "quits",       "element": "QU", "rate": "R", "label": "Quits",
     "unit": "rate", "blurb": "Worker confidence — people quit when jobs are easy to find."},
    {"key": "layoffs",     "element": "LD", "rate": "R", "label": "Layoffs & discharges",
     "unit": "rate", "blurb": "Involuntary separations — rises going into a downturn."},
    {"key": "separations", "element": "TS", "rate": "R", "label": "Total separations",
     "unit": "rate", "blurb": "All exits (quits + layoffs + other)."},
    {"key": "slack",       "element": "UO", "rate": "R", "label": "Unemployed per opening",
     "unit": "ratio", "blurb": "Slack gauge — <1 = more openings than jobseekers."},
]
JOLTS_HEAD = {h["key"]: h for h in JOLTS_HEADLINES}


def jt_sid(element, ratelevel, industry="000000", state="00",
           area="00000", size="00", seasonal="S"):
    return f"JT{seasonal}{industry}{state}{area}{size}{element}{ratelevel}"


def _jt_report(sid):
    """Monthly report rows for one JOLTS series, oldest->newest.
    Filters by series_id first (PK index) then computes point/pct change in
    Python by ordinal (gap-safe) — the v_report view self-joins the whole
    table before filtering, which is far too slow for per-series lookups."""
    rows = query(
        """
        SELECT year, period, value FROM jolts.observation
        WHERE series_id=%(sid)s AND period BETWEEN 'M01' AND 'M12'
          AND value IS NOT NULL
        ORDER BY year, period
        """, {"sid": sid})
    by_ord = {}
    seq = []
    for r in rows:
        o = r["year"] * 12 + int(r["period"][1:])
        v = float(r["value"])
        by_ord[o] = v
        seq.append((o, r["year"], r["period"], v))
    out = []
    for o, y, p, v in seq:
        pm, py = by_ord.get(o - 1), by_ord.get(o - 12)
        out.append({
            "ym": f"{y}-{int(p[1:]):02d}", "label": _label(y, p), "value": v,
            "mom_chg": round(v - pm, 2) if pm is not None else None,
            "yoy_chg": round(v - py, 2) if py is not None else None,
            "mom_pct": round((v / pm - 1) * 100, 2) if pm else None,
            "yoy_pct": round((v / py - 1) * 100, 2) if py else None,
        })
    return out


@app.get("/api/jolts/months")
def jolts_months():
    return [{"value": p["ym"], "label": p["label"]}
            for p in _jt_report(jt_sid("JO", "R"))]


@app.get("/api/jolts/overview")
def jolts_overview(industry: str = "000000", spark: int = 24):
    """The six headline series: latest value + point-change + a sparkline.
    Levels (in thousands) are attached for open/hires/quits/etc where relevant."""
    cards = []
    month = None
    for h in JOLTS_HEADLINES:
        rep = _jt_report(jt_sid(h["element"], h["rate"], industry))
        if not rep:
            continue
        last = rep[-1]
        month = last["label"]
        card = {
            "key": h["key"], "label": h["label"], "unit": h["unit"], "blurb": h["blurb"],
            "value": last["value"], "mom_chg": last["mom_chg"], "yoy_chg": last["yoy_chg"],
            "spark": [{"ym": p["ym"], "value": p["value"]} for p in rep[-spark:]],
        }
        if h["unit"] == "rate":                     # attach the level (thousands)
            lvl = _jt_report(jt_sid(h["element"], "L", industry))
            if lvl:
                card["level"] = lvl[-1]["value"]
                card["level_mom_chg"] = lvl[-1]["mom_chg"]
                card["level_yoy_chg"] = lvl[-1]["yoy_chg"]
        cards.append(card)
    return {"month": month, "industry": industry, "cards": cards}


@app.get("/api/jolts/trend")
def jolts_trend(keys: str = "openings,quits,hires", industry: str = "000000",
                frm: str = Query("2015-01", alias="from"), to: str = Query(None)):
    """Multi-series rate trend over a window — the openings-vs-quits-vs-hires read."""
    fo = _ord(frm)
    tob = _ord(to) if to else 10 ** 9
    out = []
    for k in [x for x in keys.split(",") if x in JOLTS_HEAD]:
        h = JOLTS_HEAD[k]
        rep = _jt_report(jt_sid(h["element"], h["rate"], industry))
        pts = [{"ym": p["ym"], "label": p["label"], "value": p["value"]}
               for p in rep if fo <= _ord(p["ym"]) <= tob]
        out.append({"key": k, "label": h["label"], "unit": h["unit"], "points": pts})
    return {"industry": industry, "series": out}


@app.get("/api/jolts/industry")
def jolts_industry(key: str = "openings", month: str = None):
    """Cross-industry breakdown for one metric in a given month (default latest).
    Rate value + point-change vs prior month & prior year, sorted worst-first
    for layoffs/slack, best-first otherwise (handled client-side)."""
    h = JOLTS_HEAD.get(key, JOLTS_HEAD["openings"])
    spine = _jt_report(jt_sid(h["element"], h["rate"]))
    ym = month or (spine[-1]["ym"] if spine else None)
    if not ym:
        return {"key": key, "month": None, "rows": []}
    y, m = ym.split("-"); period = f"M{int(m):02d}"
    rows = query(
        """
        SELECT ind.industry_code, ind.industry_text, ind.display_level, ind.sort_sequence,
               r.value, r.mom_chg, r.yoy_chg
        FROM jolts.v_report r
        JOIN jolts.series s ON s.series_id=r.series_id
        JOIN jolts.industry ind ON ind.industry_code=s.industry_code
        WHERE s.dataelement_code=%(el)s AND s.ratelevel_code=%(rl)s
          AND s.seasonal='S' AND s.state_code='00' AND s.area_code='00000'
          AND s.sizeclass_code='00'
          AND r.year=%(y)s AND r.period=%(p)s AND r.value IS NOT NULL
        ORDER BY ind.sort_sequence
        """, {"el": h["element"], "rl": h["rate"], "y": int(y), "p": period})
    return {"key": key, "label": h["label"], "unit": h["unit"],
            "month": _label(int(y), period), "ym": ym,
            "rows": [{"industry_code": r["industry_code"], "industry_text": r["industry_text"],
                      "display_level": r["display_level"],
                      "value": float(r["value"]),
                      "mom_chg": float(r["mom_chg"]) if r["mom_chg"] is not None else None,
                      "yoy_chg": float(r["yoy_chg"]) if r["yoy_chg"] is not None else None}
                     for r in rows]}


# NOTE: region/state breakdown was removed from the JOLTS dashboard by design —
# this cockpit is national + by-industry only. State-level JOLTS queries are
# intentionally decoupled; re-add a /api/jolts/region endpoint if ever needed.


@app.get("/api/jolts/health")
def jolts_health():
    return {"ok": True, "survey": "jolts",
            "observations": query("SELECT count(*) c FROM jolts.observation")[0]["c"],
            "series": query("SELECT count(*) c FROM jolts.series")[0]["c"]}


# ============================================================================
# CES — Current Employment Statistics (survey "ce"), the Nonfarm Payrolls data.
# Headline NFP = Total nonfarm all-employees LEVEL (thousands); the monthly
# CHANGE in that level is the "+85k jobs" print. Earnings/hours ride alongside.
# ============================================================================
CES_HEADLINES = [
    {"key": "nfp",      "industry": "00000000", "datatype": "01", "unit": "level",
     "label": "Nonfarm payrolls", "blurb": "Total jobs (000s). The monthly CHANGE is the NFP print."},
    {"key": "private",  "industry": "05000000", "datatype": "01", "unit": "level",
     "label": "Private payrolls", "blurb": "Jobs excluding government — the private engine."},
    {"key": "earnings", "industry": "05000000", "datatype": "03", "unit": "dollars",
     "label": "Avg hourly earnings", "blurb": "Wages ($/hr). YoY is the wage-inflation signal."},
    {"key": "hours",    "industry": "05000000", "datatype": "02", "unit": "hours",
     "label": "Avg weekly hours", "blurb": "Hours worked — labor-demand intensity."},
]
CES_HEAD = {h["key"]: h for h in CES_HEADLINES}


def ce_sid(industry, datatype, seasonal="S"):
    return f"CE{seasonal}{industry}{datatype}"


def _ce_report(sid):
    """Monthly report rows for one CES series, oldest->newest. Filter by
    series_id (PK index) then compute abs/pct change in Python by ordinal
    (gap-safe); mirrors _jt_report — the view self-joins too much per-series."""
    rows = query(
        """
        SELECT year, period, value FROM ces.observation
        WHERE series_id=%(sid)s AND period BETWEEN 'M01' AND 'M12'
          AND value IS NOT NULL
        ORDER BY year, period
        """, {"sid": sid})
    by_ord, seq = {}, []
    for r in rows:
        o = r["year"] * 12 + int(r["period"][1:])
        v = float(r["value"])
        by_ord[o] = v
        seq.append((o, r["year"], r["period"], v))
    out = []
    for o, y, p, v in seq:
        pm, py = by_ord.get(o - 1), by_ord.get(o - 12)
        out.append({
            "ym": f"{y}-{int(p[1:]):02d}", "label": _label(y, p), "value": v,
            "mom_chg": round(v - pm, 1) if pm is not None else None,
            "yoy_chg": round(v - py, 1) if py is not None else None,
            "mom_pct": round((v / pm - 1) * 100, 2) if pm else None,
            "yoy_pct": round((v / py - 1) * 100, 2) if py else None,
        })
    return out


@app.get("/api/ces/months")
def ces_months():
    return [{"value": p["ym"], "label": p["label"]}
            for p in _ce_report(ce_sid("00000000", "01"))]


@app.get("/api/ces/overview")
def ces_overview(spark: int = 24):
    """The four headline cards: payrolls (jobs added = mom_chg), private
    payrolls, avg hourly earnings (YoY wage growth), avg weekly hours."""
    cards, month = [], None
    for h in CES_HEADLINES:
        rep = _ce_report(ce_sid(h["industry"], h["datatype"]))
        if not rep:
            continue
        last = rep[-1]
        month = last["label"]
        cards.append({
            "key": h["key"], "label": h["label"], "unit": h["unit"], "blurb": h["blurb"],
            "value": last["value"], "mom_chg": last["mom_chg"], "yoy_chg": last["yoy_chg"],
            "mom_pct": last["mom_pct"], "yoy_pct": last["yoy_pct"],
            "spark": [{"ym": p["ym"], "value": p["value"]} for p in rep[-spark:]],
        })
    return {"month": month, "cards": cards}


@app.get("/api/ces/trend")
def ces_trend(key: str = "nfp", industry: str = None,
              frm: str = Query("1990-01", alias="from"), to: str = Query(None)):
    """One series over a window, with value + mom_chg (jobs added) + yoy per
    point. industry overrides the headline's default industry (same datatype)."""
    h = CES_HEAD.get(key, CES_HEAD["nfp"])
    ind = industry or h["industry"]
    rep = _ce_report(ce_sid(ind, h["datatype"]))
    fo, tob = _ord(frm), (_ord(to) if to else 10 ** 9)
    pts = [p for p in rep if fo <= _ord(p["ym"]) <= tob]
    return {"key": key, "label": h["label"], "unit": h["unit"],
            "industry": ind, "points": pts}


@app.get("/api/ces/industry")
def ces_industry(month: str = None):
    """Where the jobs are: each supersector's employment level + MONTHLY CHANGE
    (jobs added, 000s) + YoY, for a month (default latest). This is the sector
    contribution to the headline NFP number."""
    spine = _ce_report(ce_sid("00000000", "01"))
    ym = month or (spine[-1]["ym"] if spine else None)
    if not ym:
        return {"month": None, "rows": []}
    y, m = ym.split("-"); period = f"M{int(m):02d}"
    rows = query(
        """
        SELECT ind.industry_code, ind.industry_name, ind.display_level, ind.sort_sequence,
               r.value, r.mom_chg, r.yoy_chg, r.yoy_pct
        FROM ces.v_report r
        JOIN ces.series s   ON s.series_id = r.series_id
        JOIN ces.industry ind ON ind.industry_code = s.industry_code
        WHERE s.data_type_code='01' AND s.seasonal='S'
          AND ind.display_level <= 2
          AND r.year=%(y)s AND r.period=%(p)s AND r.value IS NOT NULL
        ORDER BY ind.sort_sequence
        """, {"y": int(y), "p": period})
    return {"month": _label(int(y), period), "ym": ym,
            "rows": [{"industry_code": r["industry_code"], "industry_name": r["industry_name"],
                      "display_level": r["display_level"],
                      "value": float(r["value"]),
                      "mom_chg": float(r["mom_chg"]) if r["mom_chg"] is not None else None,
                      "yoy_chg": float(r["yoy_chg"]) if r["yoy_chg"] is not None else None,
                      "yoy_pct": float(r["yoy_pct"]) if r["yoy_pct"] is not None else None}
                     for r in rows]}


@app.get("/api/ces/health")
def ces_health():
    return {"ok": True, "survey": "ces",
            "observations": query("SELECT count(*) c FROM ces.observation")[0]["c"],
            "series": query("SELECT count(*) c FROM ces.series")[0]["c"]}


# ============================================================================
# PCE — BEA Personal Consumption Expenditures. Its own tab: "what people spend
# money on." Two measures per line: 'D' current-dollar spending, 'P' price index.
# MoM/YoY/share computed in Python by ordinal (gap-safe), not via the view.
# ============================================================================
PCE_HEADLINE = 1     # Personal consumption expenditures (PCE)
PCE_CORE     = 25    # PCE excluding food and energy
PCE_SUPER    = 28    # PCE services excluding energy and housing (supercore)


def _pce_series(line_number, measure):
    rows = query(
        """SELECT year, period, value FROM pce.observation
           WHERE line_number=%(l)s AND measure=%(m)s
             AND period BETWEEN 'M01' AND 'M12' AND value IS NOT NULL
           ORDER BY year, period""",
        {"l": line_number, "m": measure})
    return [{"year": r["year"], "period": r["period"], "value": float(r["value"]),
             "ord": r["year"] * 12 + int(r["period"][1:]),
             "ym": f"{r['year']}-{int(r['period'][1:]):02d}",
             "label": _label(r["year"], r["period"])} for r in rows]


def _pce_de(n):
    """ordinal -> (year, 'M0x')"""
    return (n - 1) // 12, f"M{((n - 1) % 12) + 1:02d}"


def _pce_monthvals(ordv, measure):
    y, p = _pce_de(ordv)
    rows = query(
        """SELECT line_number, value FROM pce.observation
           WHERE measure=%(m)s AND year=%(y)s AND period=%(p)s AND value IS NOT NULL""",
        {"m": measure, "y": y, "p": p})
    return {r["line_number"]: float(r["value"]) for r in rows}


def _pct(cur, base):
    return round((cur / base - 1) * 100, 2) if (cur is not None and base) else None


@app.get("/api/pce/health")
def pce_health():
    return {"ok": True, "survey": "pce",
            "observations": query("SELECT count(*) c FROM pce.observation")[0]["c"],
            "lines": query("SELECT count(*) c FROM pce.line")[0]["c"]}


@app.get("/api/pce/months")
def pce_months():
    return [{"value": p["ym"], "label": p["label"]} for p in _pce_series(PCE_HEADLINE, "D")]


@app.get("/api/pce/overview")
def pce_overview():
    """Hero numbers: total consumer spending ($, annual rate) + its growth, and
    the three inflation gauges (headline/core/supercore prices)."""
    spine = _pce_series(PCE_HEADLINE, "D")
    if not spine:
        return {"month": None, "cards": []}
    o = spine[-1]["ord"]
    ym = spine[-1]["ym"]
    d_cur, d_mom, d_yoy = _pce_monthvals(o, "D"), _pce_monthvals(o - 1, "D"), _pce_monthvals(o - 12, "D")
    p_cur, p_mom, p_yoy = _pce_monthvals(o, "P"), _pce_monthvals(o - 1, "P"), _pce_monthvals(o - 12, "P")

    def price_card(ln, label, blurb):
        return {"key": f"price{ln}", "label": label, "kind": "price",
                "value_yoy": _pct(p_cur.get(ln), p_yoy.get(ln)),
                "value_mom": _pct(p_cur.get(ln), p_mom.get(ln)), "blurb": blurb}

    cards = [
        {"key": "spend", "label": "Consumer spending", "kind": "dollars",
         "level_millions": d_cur.get(PCE_HEADLINE),
         "value_yoy": _pct(d_cur.get(PCE_HEADLINE), d_yoy.get(PCE_HEADLINE)),
         "value_mom": _pct(d_cur.get(PCE_HEADLINE), d_mom.get(PCE_HEADLINE)),
         "blurb": "total PCE, annual rate"},
        price_card(PCE_HEADLINE, "Headline PCE inflation", "all prices"),
        price_card(PCE_CORE, "Core PCE inflation", "ex food & energy · Fed's 2% target"),
        price_card(PCE_SUPER, "Supercore inflation", "services ex energy & housing"),
    ]
    return {"month": spine[-1]["label"], "ym": ym, "cards": cards}


@app.get("/api/pce/breakdown")
def pce_breakdown(month: str = None, include_addenda: bool = False):
    """What people spend on, for one month: each line's share of wallet + spend
    growth + the price change on that category. Default latest month."""
    spine = _pce_series(PCE_HEADLINE, "D")
    if not spine:
        return {"month": None, "rows": []}
    ym = month or spine[-1]["ym"]
    o = _ord(ym)
    d_cur, d_mom, d_yoy = _pce_monthvals(o, "D"), _pce_monthvals(o - 1, "D"), _pce_monthvals(o - 12, "D")
    p_cur, p_mom, p_yoy = _pce_monthvals(o, "P"), _pce_monthvals(o - 1, "P"), _pce_monthvals(o - 12, "P")
    total = d_cur.get(PCE_HEADLINE)
    lines = query(
        """SELECT line_number, line_text, display_level, parent_line, is_addendum
           FROM pce.line ORDER BY line_number""")
    out = []
    for l in lines:
        ln = l["line_number"]
        if l["is_addendum"] and not include_addenda:
            continue
        cur = d_cur.get(ln)
        if cur is None:
            continue
        out.append({
            "line": ln, "line_text": l["line_text"],
            "display_level": l["display_level"], "parent_line": l["parent_line"],
            "is_addendum": l["is_addendum"],
            "spend_millions": cur,
            "share_pct": round(cur / total * 100, 2) if total else None,
            "spend_yoy": _pct(cur, d_yoy.get(ln)),
            "spend_mom": _pct(cur, d_mom.get(ln)),
            "price_yoy": _pct(p_cur.get(ln), p_yoy.get(ln)),
            "price_mom": _pct(p_cur.get(ln), p_mom.get(ln)),
        })
    yy, mm = ym.split("-")
    return {"month": _label(int(yy), f"M{int(mm):02d}"),
            "ym": ym, "total_millions": total, "rows": out}


@app.get("/api/pce/trend")
def pce_trend(line: int = PCE_HEADLINE, measure: str = "D",
              frm: str = Query("1960-01", alias="from"), to: str = Query(None)):
    """One line's spending ($) or price index over time, with YoY per point."""
    measure = "P" if measure.upper() == "P" else "D"
    s = _pce_series(line, measure)
    vby = {p["ord"]: p["value"] for p in s}
    fo = _ord(frm)
    tob = _ord(to) if to else 10 ** 9
    pts = []
    for p in s:
        if not (fo <= p["ord"] <= tob):
            continue
        pts.append({"ym": p["ym"], "label": p["label"], "value": p["value"],
                    "yoy": _pct(p["value"], vby.get(p["ord"] - 12))})
    meta = query("SELECT line_text FROM pce.line WHERE line_number=%(l)s", {"l": line})
    return {"line": line, "measure": measure,
            "line_text": meta[0]["line_text"] if meta else str(line), "points": pts}


# ── Economic calendar (read-only; data lives in calendar.event, ingested
#    separately from the Forex Factory feed — the app never calls the feed) ──
def _cal_num(s):
    if not s:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", s.replace(",", ""))
    return float(m.group()) if m else None


@app.get("/api/calendar")
def calendar(country: str = "USD", impacts: str = "High,Medium",
             past_days: int = 21, ahead_days: int = 10):
    """Upcoming + past economic events from calendar.event. Times are UTC in
    the payload; the frontend renders SAST. Surprise = actual - forecast when
    both parse numerically."""
    imp = [i for i in impacts.split(",") if i]
    all_c = country.lower() in ("", "all")
    rows = query(
        """
        SELECT event_at, country, title, impact, forecast, previous, actual
        FROM calendar.event
        WHERE (%(all_c)s OR country = %(country)s)
          AND (%(all_i)s OR impact = ANY(%(imp)s))
          AND event_at >= now() - make_interval(days => %(pd)s)
          AND event_at <= now() + make_interval(days => %(ad)s)
        ORDER BY event_at
        """,
        {"country": country, "all_c": all_c, "imp": imp, "all_i": not imp,
         "pd": past_days, "ad": ahead_days},
    )
    now = datetime.now(timezone.utc)
    up, past = [], []
    for r in rows:
        f, a = _cal_num(r["forecast"]), _cal_num(r["actual"])
        r["surprise"] = round(a - f, 2) if (a is not None and f is not None) else None
        (up if r["event_at"] >= now else past).append(r)
    past.reverse()
    return {"now": now.isoformat(), "upcoming": up, "past": past}
