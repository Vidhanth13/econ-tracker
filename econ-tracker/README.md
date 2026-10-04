# econ-tracker — the app

The **"see & understand"** half of Econ Tracker. Reads the Postgres data loaded by [`econ-data`](../econ-data) and turns it into fast, interactive dashboards.

> Plain terms: **this is what you actually open and look at.** Two processes: a backend that serves the numbers, a frontend that draws them.

---

## How it's put together

```
Postgres (econ_data)  ──►  backend/  (FastAPI :8010)  ──►  frontend/  (React+Vite :5183)  ──►  browser
```

### `backend/` — FastAPI (Python)
The data server. Exposes read-only `/api/*` endpoints that query Postgres and return JSON.
- **`main.py`** — all the endpoints. One family per survey: `/api/headline`, `/api/momentum`, `/api/trend`, `/api/node`, plus dedicated `/api/jolts/*`, `/api/ces/*`, `/api/pce/*`. Most take a `?survey=` (and some a `?cls=`) parameter so one codebase serves several datasets.
- **`db.py`** — thin, **read-only** Postgres access layer. Connection details come from a git-ignored `.env`.

### `frontend/` — React + Vite + Tailwind
What you see. A single-page app with a survey switcher across the top.
- **`src/App.jsx`** — the shell + the shared CPI-style "cockpit" (hero cards, momentum, category breakdown, trend chart, release history).
- **`src/PPIExplorer.jsx` · `JoltsExplorer.jsx` · `CesExplorer.jsx` · `PceExplorer.jsx`** — dataset-specific views that render their own native layout instead of the generic cockpit.
- **`src/LineChart.jsx`** — the reusable chart (pure SVG).
- **`src/api.js`** — every call the frontend makes to the backend, in one place.

## Running it

**One-click:** `Econ Tracker.bat` on the Desktop — starts both servers and opens the browser.

**Manual (two terminals):**
```bash
# terminal 1 — backend
cd backend
cp .env.example .env          # fill in your Postgres password
python -m uvicorn main:app --port 8010

# terminal 2 — frontend
cd frontend
npm install                   # first time only
npm run dev                   # opens http://localhost:5183
```
Postgres must be running, with `econ_data` loaded by the [`econ-data`](../econ-data) pipeline.

## Dev notes
- **Vite is the live server** — save a `.jsx` and the browser hot-reloads. Change `main.py` and you restart uvicorn.
- `node_modules/`, `dist/`, `.env` and logs are git-ignored.

## Secrets
Backend DB credentials live in `backend/.env` (git-ignored). See `backend/.env.example`.
