-- ============================================================================
-- econ_data :: CES schema  (BLS Current Employment Statistics — survey "ce")
-- ----------------------------------------------------------------------------
-- CES is the ESTABLISHMENT survey behind Nonfarm Payrolls (NFP). It reports,
-- per industry, either an employment LEVEL (thousands of jobs) or a wage/hours
-- data type (avg hourly earnings $, avg weekly hours). The market's headline
-- "jobs added" number is the MONTH-OVER-MONTH CHANGE in the Total nonfarm
-- all-employees level (thousands) — an ABSOLUTE change, not a pct.
--
-- Series ID layout (national survey "ce"):
--   CE + seasonal(1) + supersector(2) + industry(6) + datatype(2)
--   stored whole as series_id, e.g.
--     CES0000000001  SA, Total nonfarm, ALL employees (thousands)   <- NFP
--     CEU0000000001  NSA counterpart
--     CES0500000003  SA, Total private, avg hourly earnings ($)
--     CES0500000011  SA, Total private, avg weekly hours
--
-- Headline data types (ce.datatype):
--   01 All employees, thousands          <- the payrolls level; MoM chg = NFP
--   03 Avg hourly earnings, all employees, $     (wage-inflation signal)
--   11 Avg weekly hours, all employees
--
-- Source flat files (need a real UA): https://download.bls.gov/pub/time.series/ce/
--   ce.datatype    -> ces.datatype      ce.industry    -> ces.industry
--   ce.supersector -> ces.supersector   ce.series      -> ces.series
--   ce.data.*      -> ces.observation
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS ces;

-- --- Dimension tables --------------------------------------------------------
CREATE TABLE IF NOT EXISTS ces.datatype (
    data_type_code   text PRIMARY KEY,
    data_type_text   text NOT NULL
);

CREATE TABLE IF NOT EXISTS ces.supersector (
    supersector_code text PRIMARY KEY,
    supersector_name text NOT NULL
);

CREATE TABLE IF NOT EXISTS ces.industry (
    industry_code    text PRIMARY KEY,
    naics_code       text,
    publishing_status text,
    display_level    int,
    selectable       char(1),
    sort_sequence    int,
    industry_name    text NOT NULL
);

-- --- Series dimension --------------------------------------------------------
-- One row per distinct series. Scalar dimension FKs only (a data mirror must
-- not drop a series if a dictionary code is momentarily absent).
CREATE TABLE IF NOT EXISTS ces.series (
    series_id        text PRIMARY KEY,
    supersector_code text REFERENCES ces.supersector(supersector_code),
    industry_code    text REFERENCES ces.industry(industry_code),
    data_type_code   text REFERENCES ces.datatype(data_type_code),
    seasonal         char(1),                   -- 'S' | 'U'
    series_title     text,
    footnote_codes   text,
    begin_year       int,
    begin_period     text,
    end_year         int,
    end_period       text
);
CREATE INDEX IF NOT EXISTS ix_ces_series_datatype    ON ces.series(data_type_code);
CREATE INDEX IF NOT EXISTS ix_ces_series_supersector ON ces.series(supersector_code);
CREATE INDEX IF NOT EXISTS ix_ces_series_industry    ON ces.series(industry_code);
CREATE INDEX IF NOT EXISTS ix_ces_series_seasonal    ON ces.series(seasonal);

-- --- Observations (the values) ----------------------------------------------
-- period: M01..M12 monthly, M13 = annual average; value NULL when withheld.
-- Units depend on data type: 01 = thousands of jobs; 03 = dollars; 11 = hours.
CREATE TABLE IF NOT EXISTS ces.observation (
    series_id        text NOT NULL REFERENCES ces.series(series_id),
    year             int  NOT NULL,
    period           text NOT NULL,             -- M01..M13
    value            numeric,
    footnote_codes   text,
    PRIMARY KEY (series_id, year, period)
);
CREATE INDEX IF NOT EXISTS ix_ces_obs_period ON ces.observation(year, period);

-- --- Report view: value + changes vs prior month / prior year ---------------
-- mom_chg / yoy_chg are ABSOLUTE change (thousands of jobs for the payrolls
-- level — the "+85k" NFP number; dollars for earnings). mom_pct / yoy_pct give
-- the percent change (the right lens for wages). Monthly points only.
CREATE OR REPLACE VIEW ces.v_report AS
WITH obs AS (
    SELECT o.series_id, s.seasonal, s.data_type_code,
           s.supersector_code, s.industry_code,
           o.year, o.period, o.value,
           ((o.year * 12) + CAST(substring(o.period from 2) AS int)) AS ord
    FROM ces.observation o
    JOIN ces.series s ON s.series_id = o.series_id
    WHERE o.period BETWEEN 'M01' AND 'M12'
)
SELECT
    o.series_id, o.seasonal, o.data_type_code,
    o.supersector_code, o.industry_code,
    o.year, o.period, o.value,
    round(o.value - pm.value, 1)                            AS mom_chg,   -- thousands / $
    round(o.value - py.value, 1)                            AS yoy_chg,
    round((o.value / NULLIF(pm.value, 0) - 1) * 100, 2)     AS mom_pct,
    round((o.value / NULLIF(py.value, 0) - 1) * 100, 2)     AS yoy_pct
FROM obs o
LEFT JOIN obs pm ON pm.series_id = o.series_id AND pm.ord = o.ord - 1
LEFT JOIN obs py ON py.series_id = o.series_id AND py.ord = o.ord - 12;

COMMENT ON SCHEMA ces IS 'BLS Current Employment Statistics (survey ce) — the establishment survey behind Nonfarm Payrolls. Employment level (thousands), avg hourly earnings ($), avg weekly hours, by industry, SA+NSA. Headline NFP = Total nonfarm all-employees level CES0000000001; monthly jobs added = its mom_chg (thousands). v_report gives value + absolute change (jobs/$) + pct change (wages).';
