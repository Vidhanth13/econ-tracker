-- ============================================================================
-- econ_data :: JOLTS schema  (BLS Job Openings & Labor Turnover — survey "jt")
-- ----------------------------------------------------------------------------
-- JOLTS is NOT a price index. It reports labor-market FLOWS as either a
-- LEVEL (thousands of jobs/people) or a RATE (% of employment). The story is
-- the rate/level itself and its trend, not a MoM/YoY on an index base.
--
-- Series ID layout (fixed-width, 20 chars after the JT prefix logic):
--   JT + seasonal(1) + industry(6) + state(2) + area(5) + sizeclass(2)
--      + dataelement(2) + ratelevel(1)
--   e.g. JTS000000000000000JOL = SA, Total nonfarm, US, all sizes,
--        Job openings, Level.  ...JOR = same, Rate.
--
-- Headline series the market watches (all SA, Total nonfarm, US, all sizes):
--   Job openings level   JTS000000000000000JOL   (the "openings" headline)
--   Job openings rate    JTS000000000000000JOR
--   Quits rate           JTS000000000000000QUR   (labor-confidence signal)
--   Hires rate           JTS000000000000000HIR
--   Layoffs rate         JTS000000000000000LDR
--   Unempl. per opening  JTS000000000000000UOR   (slack gauge; UO element)
--
-- Source flat files (need a real UA): https://download.bls.gov/pub/time.series/jt/
--   jt.dataelement -> jt.dataelement   jt.industry -> jt.industry
--   jt.state       -> jt.state         jt.area     -> jt.area
--   jt.sizeclass   -> jt.sizeclass     jt.ratelevel-> jt.ratelevel
--   jt.series      -> jt.series        jt.data.*   -> jt.observation
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS jolts;

-- --- Dimension tables --------------------------------------------------------
CREATE TABLE IF NOT EXISTS jolts.dataelement (
    dataelement_code text PRIMARY KEY,
    dataelement_text text NOT NULL,
    display_level    int,
    selectable       char(1),
    sort_sequence    int
);

CREATE TABLE IF NOT EXISTS jolts.ratelevel (
    ratelevel_code   char(1) PRIMARY KEY,       -- 'L' level (thousands) | 'R' rate (%)
    ratelevel_text   text NOT NULL,
    display_level    int,
    selectable       char(1),
    sort_sequence    int
);

CREATE TABLE IF NOT EXISTS jolts.industry (
    industry_code    text PRIMARY KEY,
    industry_text    text NOT NULL,
    display_level    int,
    selectable       char(1),
    sort_sequence    int
);

CREATE TABLE IF NOT EXISTS jolts.state (
    state_code       text PRIMARY KEY,
    state_text       text NOT NULL,
    display_level    int,
    selectable       char(1),
    sort_sequence    int
);

CREATE TABLE IF NOT EXISTS jolts.area (
    area_code        text PRIMARY KEY,
    area_text        text NOT NULL,
    display_level    int,
    selectable       char(1),
    sort_sequence    int
);

CREATE TABLE IF NOT EXISTS jolts.sizeclass (
    sizeclass_code   text PRIMARY KEY,
    sizeclass_text   text NOT NULL,
    display_level    int,
    selectable       char(1),
    sort_sequence    int
);

-- --- Series dimension --------------------------------------------------------
-- One row per distinct series. No composite FKs to the dimension tables on
-- purpose (a data mirror should not drop a series if a code is momentarily
-- absent from a dictionary); the scalar dimension FKs below are safe because
-- those dictionaries are small and always complete.
CREATE TABLE IF NOT EXISTS jolts.series (
    series_id        text PRIMARY KEY,
    seasonal         char(1),                   -- 'S' | 'U'
    industry_code    text REFERENCES jolts.industry(industry_code),
    state_code       text REFERENCES jolts.state(state_code),
    area_code        text REFERENCES jolts.area(area_code),
    sizeclass_code   text REFERENCES jolts.sizeclass(sizeclass_code),
    dataelement_code text REFERENCES jolts.dataelement(dataelement_code),
    ratelevel_code   char(1) REFERENCES jolts.ratelevel(ratelevel_code),
    footnote_codes   text,
    begin_year       int,
    begin_period     text,
    end_year         int,
    end_period       text
);
CREATE INDEX IF NOT EXISTS ix_jolts_series_element  ON jolts.series(dataelement_code);
CREATE INDEX IF NOT EXISTS ix_jolts_series_ratelvl  ON jolts.series(ratelevel_code);
CREATE INDEX IF NOT EXISTS ix_jolts_series_industry ON jolts.series(industry_code);
CREATE INDEX IF NOT EXISTS ix_jolts_series_state    ON jolts.series(state_code);
CREATE INDEX IF NOT EXISTS ix_jolts_series_seasonal ON jolts.series(seasonal);

-- --- Observations (the values) ----------------------------------------------
-- period: M01..M12 monthly, M13 = annual average; value NULL when withheld.
-- For ratelevel 'L' value is thousands; for 'R' value is a percent (rate).
CREATE TABLE IF NOT EXISTS jolts.observation (
    series_id        text NOT NULL REFERENCES jolts.series(series_id),
    year             int  NOT NULL,
    period           text NOT NULL,             -- M01..M13
    value            numeric,
    footnote_codes   text,
    PRIMARY KEY (series_id, year, period)
);
CREATE INDEX IF NOT EXISTS ix_jolts_obs_period ON jolts.observation(year, period);

-- --- Report view: value + changes vs prior month / prior year ---------------
-- Unlike CPI/PPI this exposes ABSOLUTE change (mom_chg / yoy_chg) — the right
-- unit for a rate (points) — alongside pct change (right for a level).
-- Monthly points only (excludes M13 annual average).
CREATE OR REPLACE VIEW jolts.v_report AS
WITH obs AS (
    SELECT o.series_id, s.seasonal, s.dataelement_code, s.ratelevel_code,
           s.industry_code, s.state_code, s.sizeclass_code,
           o.year, o.period, o.value,
           ((o.year * 12) + CAST(substring(o.period from 2) AS int)) AS ord
    FROM jolts.observation o
    JOIN jolts.series s ON s.series_id = o.series_id
    WHERE o.period BETWEEN 'M01' AND 'M12'
)
SELECT
    o.series_id, o.seasonal, o.dataelement_code, o.ratelevel_code,
    o.industry_code, o.state_code, o.sizeclass_code,
    o.year, o.period, o.value,
    round(o.value - pm.value, 2)                            AS mom_chg,   -- points
    round(o.value - py.value, 2)                            AS yoy_chg,   -- points
    round((o.value / NULLIF(pm.value, 0) - 1) * 100, 2)     AS mom_pct,   -- level %
    round((o.value / NULLIF(py.value, 0) - 1) * 100, 2)     AS yoy_pct    -- level %
FROM obs o
LEFT JOIN obs pm ON pm.series_id = o.series_id AND pm.ord = o.ord - 1
LEFT JOIN obs py ON py.series_id = o.series_id AND py.ord = o.ord - 12;

COMMENT ON SCHEMA jolts IS 'BLS Job Openings & Labor Turnover Survey (survey jt). Labor-market flows as level (thousands) or rate (%). Headline = Total nonfarm US SA: openings JTS000000000000000JOL/JOR, quits QUR, hires HIR. v_report gives value + point-change (rates) + pct-change (levels).';
