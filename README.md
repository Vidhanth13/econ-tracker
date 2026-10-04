# 📊 Econ Tracker

A **database-backed economic-release cockpit** — US macro data pulled from official sources, stored in Postgres, served by an API, and explored through a fast web app. Built as a component of a larger trading system: the goal is to *read the economy well enough to catch positions*.

> **Design principle — no LLM in the pipeline.** Every number is sourced, stored and computed deterministically. Interpretation is a mix of fixed reference blurbs and the user's own written judgement — never machine-generated.

---

## Repository layout

This repo holds **two cooperating halves**:

| Folder | What it is | Changes |
|---|---|---|
| **[`econ-data/`](./econ-data)** | The **data pipeline** — Python scripts that fetch official US economic data and load it into Postgres. The "get the numbers in" layer. | Occasionally (new surveys / sources) |
| **[`econ-tracker/`](./econ-tracker)** | The **application** — a FastAPI backend (reads Postgres) + a React/Vite frontend (the dashboards you actually look at). The "see & understand" layer. | Often (features / tweaks) |

```
   official sources            econ-data/              Postgres            econ-tracker/
  (BLS flat files, BEA)  ──►  ingest scripts  ──►   econ_data DB   ──►   FastAPI  ──►  React app
```

Each half has its own README with the detail — start there.

## The data so far
- **CPI** (consumer prices) · **PPI** (producer prices) · **JOLTS** (labour flows) · **CES/NFP** (payrolls) · **PCE** (consumer spending + prices).
- History reaching back to **1913** for the deep price series.

## Stack
Python · PostgreSQL · FastAPI · React + Vite + Tailwind.

## Running it
- **One-click:** `Econ Tracker.bat` on the Desktop (starts backend :8010 + frontend :5183, opens the browser).
- **Manual:** see [`econ-tracker/README`](./econ-tracker). Postgres must be running.

## Secrets
No credentials live in this repo. Each half reads its secrets from a **git-ignored `.env`** file; a committed **`.env.example`** shows which variables to set. Copy it to `.env` and fill in your own values.
