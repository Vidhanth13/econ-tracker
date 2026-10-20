# 📊 Econ Tracker

A **database-backed economic-release cockpit** — U.S. macro data pulled from official sources, stored in Postgres, served by an API, and explored through a fast web app. I built it as the information layer of my own trading system: **read the economy well enough to catch positions.**

> **Design principle — no LLM in the pipeline.** Every number is sourced, stored and computed deterministically. Interpretation is fixed reference context plus the user's own written judgement, never machine-generated.

![Econ Tracker — trend view](econ-tracker/preview-chart.png)

---

## Why I built it

I trade and I follow the markets closely, and I wanted to read the macro the way it actually moves price — inflation, the labour market, producer prices and consumer spending, side by side, with momentum and decades of history a click away. So I built the whole stack myself: a pipeline that ingests the official BLS/BEA flat files into Postgres, an API that serves them read-only, and dashboards that make them fast to explore. Millions of observations, kept clean, reproducible and deterministic.

## Views

| Producer prices (PPI) | Labour market (JOLTS) |
| --- | --- |
| ![PPI commodity lens](econ-tracker/preview-ppi-commodity.png) | ![JOLTS](econ-tracker/preview-jolts.png) |

## Repository layout

Two cooperating halves:

| Folder | What it is |
|---|---|
| **[`econ-data/`](./econ-data)** | The **data pipeline** — Python scripts that fetch official U.S. economic data and load it into Postgres. The "get the numbers in" layer. |
| **[`econ-tracker/`](./econ-tracker)** | The **application** — a FastAPI backend (reads Postgres) + a React/Vite frontend (the dashboards). The "see & understand" layer. |

```
   official sources            econ-data/              Postgres            econ-tracker/
  (BLS flat files, BEA)  ──►  ingest scripts  ──►   econ_data DB   ──►   FastAPI  ──►  React app
```

![Architecture](econ-tracker/architecture.png)

Each half has its own README with the detail.

## The data so far

| Survey | Source | Range | Scale |
| --- | --- | --- | --- |
| **CPI** — consumer prices | BLS | 1913 → present | ~424k observations |
| **PPI** — producer prices | BLS | 1913 → present | ~1.8M observations |
| **JOLTS** — labour flows | BLS | job openings, hires, separations | — |
| **CES / NFP** — payrolls | BLS | employment | — |
| **PCE** — consumer spending & prices | BEA | — | — |

## Stack

**Python · PostgreSQL · FastAPI · React + Vite + Tailwind · SVG charting.**

## Running it

- **One-click:** `Econ Tracker.bat` (starts backend :8010 + frontend :5183, opens the browser).
- **Manual:** see [`econ-tracker/README`](./econ-tracker). Postgres must be running with `econ_data` loaded by the pipeline.

## Secrets

No credentials live in this repo. Each half reads its secrets from a **git-ignored `.env`**; a committed **`.env.example`** shows which variables to set.

## Data sources

U.S. Bureau of Labor Statistics (CPI, PPI, JOLTS, CES) and U.S. Bureau of Economic Analysis (PCE) — official public-domain releases.
