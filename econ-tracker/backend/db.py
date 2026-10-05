"""Thin Postgres access layer for the Econ Tracker API (read-only)."""
import os
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

_CONN = dict(
    host=os.environ.get("PGHOST", "localhost"),
    port=os.environ.get("PGPORT", "5432"),
    dbname=os.environ.get("PGDATABASE", "econ_data"),
    user=os.environ.get("PGUSER", "jarvis"),
    password=os.environ.get("PGPASSWORD", ""),
)


def query(sql, params=None):
    """Run a SELECT and return a list of dicts."""
    conn = psycopg2.connect(**_CONN)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params or {})
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def execute(sql, params=None, returning=True):
    """Run a write (INSERT/UPDATE/DELETE), commit, and return any RETURNING rows."""
    conn = psycopg2.connect(**_CONN)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params or {})
            rows = cur.fetchall() if (returning and cur.description) else []
            conn.commit()
            return [dict(r) for r in rows]
    finally:
        conn.close()
