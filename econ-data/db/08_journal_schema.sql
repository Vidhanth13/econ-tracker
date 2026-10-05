-- 08_journal_schema.sql — per-dashboard research/positioning journal.
-- User-written notes tied to a data point (survey), with an optional topic tag
-- (e.g. "eggs") to thread a thesis and an optional position idea. No LLM — the
-- judgement is the user's; this just persists it.

CREATE SCHEMA IF NOT EXISTS journal;

CREATE TABLE IF NOT EXISTS journal.entry (
    id         bigserial PRIMARY KEY,
    survey     text        NOT NULL,     -- cpi | ppi | jolts | ces | pce
    topic      text,                     -- optional tag, e.g. "eggs"
    note       text        NOT NULL,     -- the thought / research
    position   text,                     -- optional position idea (index/stock)
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS journal_survey_idx ON journal.entry (survey, created_at DESC);
