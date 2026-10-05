-- 07_calendar_schema.sql — economic release calendar.
-- Decoupled + persistent: events are ingested from the public Forex Factory
-- weekly feed into this table; the app reads ONLY from here (never the live feed).
-- Re-running the loader fills in `actual` as releases print and accumulates
-- past events over time.

CREATE SCHEMA IF NOT EXISTS calendar;

CREATE TABLE IF NOT EXISTS calendar.event (
    id          bigserial PRIMARY KEY,
    event_at    timestamptz NOT NULL,      -- stored in UTC; the app renders SAST
    country     text        NOT NULL,
    title       text        NOT NULL,
    impact      text,
    forecast    text,
    previous    text,
    actual      text,
    fetched_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (country, title, event_at)       -- dedup key for idempotent upsert
);

CREATE INDEX IF NOT EXISTS event_at_idx ON calendar.event (event_at);
