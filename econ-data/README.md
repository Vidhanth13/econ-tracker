# econ-data — the data pipeline

The **"get the numbers in"** half of Econ Tracker. A set of Python scripts that fetch official US economic data and load it into the Postgres database `econ_data`, which the [app](../econ-tracker) then reads.

> Plain terms: **this is the Python that brings the data in — from where, and how.**

---

## Where the data comes from

| Source | What | How we fetch it |
|---|---|---|
| **BLS flat files** (`download.bls.gov/pub/time.series/…`) | CPI (`cu`), PPI (`wp`), JOLTS (`jt`), CES payrolls (`ce`) | Download the published tab-separated time-series files over HTTP (a real User-Agent header is required or BLS blocks you). |
| **BEA NIPA API** (`apps.bea.gov/api`) | PCE — consumer spending + prices | JSON API call; needs a free **BEA UserID** key (kept in `.env`). |
| **Release calendars** (TradingView / Forex Factory) | Consensus + actual for release dates | Pulled for the expectations/surprise layer. |

## How it loads (the method)

- **Bulk load via `psql \copy`** — the big BLS files are cleaned into temp TSVs and streamed straight into Postgres with `psql.exe` (fast; no row-by-row inserts). BEA data goes in via `psycopg2`.
- **Idempotent backfill** — loaders **truncate + reload** their schema, so re-running is safe and repeatable (no duplicates, no drift).
- **Schema-per-survey** — each dataset gets its own Postgres schema (`cpi.*`, `ppi.*`, `jolts.*`, …) with a matching report view, so surveys stay isolated but shaped alike.
- **Robust discovery** — BLS filenames contain hyphens (e.g. `wp.data.22.FD-ID`), so files are found by parsing the directory's real links rather than guessing names.

## Layout

```
econ-data/
├── db/            # SQL — schema definitions + report views per survey
├── ingest/        # the Python loaders
│   ├── load_cpi.py      load_ppi.py     load_jolts.py
│   ├── load_ces.py      load_pce.py     load_releases.py
│   ├── load_latest.py   import_latest.py
│   ├── _env.py          # tiny dependency-free .env loader (keeps secrets out of code)
│   └── .env.example     # copy to .env, fill in your keys
└── *.json         # cached BEA responses
```

## Running a loader

```bash
cd ingest
cp .env.example .env     # then fill in BEA_API_KEY + PGPASSWORD
python load_cpi.py       # or load_ppi.py / load_jolts.py / …
```

Loaders are idempotent — re-run any time to refresh. Postgres must be running and the `econ_data` database must exist.

## Secrets
`BEA_API_KEY` and `PGPASSWORD` are read from `ingest/.env` (git-ignored). The code never contains them. See `.env.example` for the shape.
