-- ============================================================================
-- econ_data :: CPI schema  (BLS Consumer Price Index — survey code "cu")
-- ----------------------------------------------------------------------------
-- Structured mirror of the CPI news-release tables (Table 1/2 etc.), pulled
-- from BLS. Never parse the PDF: every printed line = a BLS series
-- (item x area x seasonal). We store the raw series + the category tree, and
-- compute MoM/YoY in a view so we can regenerate any month's "what moved" table.
--
-- Source flat files (no key): https://download.bls.gov/pub/time.series/cu/
--   cu.item   -> cpi.item        cu.area   -> cpi.area
--   cu.series -> cpi.series      cu.data.* -> cpi.observation
-- API (JSON, free key): https://api.bls.gov/publicAPI/v2/timeseries/data/
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS cpi;

-- --- Category tree -----------------------------------------------------------
-- The item dictionary. display_level = indent depth (0=All items ... 6=leaf like
-- "White bread"); sort_sequence = the exact order the PDF prints the rows.
CREATE TABLE IF NOT EXISTS cpi.item (
    item_code       text PRIMARY KEY,
    item_name       text NOT NULL,
    display_level   int,
    selectable      boolean,
    sort_sequence   int
);

-- --- Geographic areas --------------------------------------------------------
-- 0000 = U.S. city average; plus regions, size classes, and metro areas.
CREATE TABLE IF NOT EXISTS cpi.area (
    area_code       text PRIMARY KEY,
    area_name       text NOT NULL,
    display_level   int,
    selectable      boolean,
    sort_sequence   int
);

-- --- Series dimension --------------------------------------------------------
-- One row per distinct series. series_id encodes area+item+seasonal, e.g.
-- CUSR0000SETB01 = (CU)(S=seas.adj)(R)(0000=US avg)(SETB01=gasoline).
-- seasonal: 'S' seasonally adjusted, 'U' not adjusted.
CREATE TABLE IF NOT EXISTS cpi.series (
    series_id         text PRIMARY KEY,
    area_code         text REFERENCES cpi.area(area_code),
    item_code         text REFERENCES cpi.item(item_code),
    seasonal          char(1),                 -- 'S' | 'U'
    periodicity_code  text,
    base_code         text,
    base_period       text,
    series_title      text,
    begin_year        int,
    begin_period      text,
    end_year          int,
    end_period        text
);
CREATE INDEX IF NOT EXISTS ix_cpi_series_item ON cpi.series(item_code);
CREATE INDEX IF NOT EXISTS ix_cpi_series_seasonal ON cpi.series(seasonal);

-- --- Observations (the values) ----------------------------------------------
-- period: M01..M12 monthly, M13 = annual average; value NULL when BLS withheld
-- it (e.g. footnote 'X' = 2025 appropriations lapse). One row per series/month.
CREATE TABLE IF NOT EXISTS cpi.observation (
    series_id       text NOT NULL REFERENCES cpi.series(series_id),
    year            int  NOT NULL,
    period          text NOT NULL,             -- M01..M13
    value           numeric,                   -- index level; NULL if withheld
    footnote_codes  text,
    PRIMARY KEY (series_id, year, period)
);
CREATE INDEX IF NOT EXISTS ix_cpi_obs_period ON cpi.observation(year, period);

-- --- Report view: regenerate the PDF table for any month ---------------------
-- Joins values to the category tree and computes MoM (vs prior month) and
-- YoY (vs same month last year). Monthly points only (excludes M13 annual).
CREATE OR REPLACE VIEW cpi.v_report AS
WITH obs AS (
    SELECT o.series_id, s.item_code, i.item_name, i.display_level, i.sort_sequence,
           s.seasonal, o.year, o.period, o.value,
           ((o.year * 12) + CAST(substring(o.period from 2) AS int)) AS ord
    FROM cpi.observation o
    JOIN cpi.series s ON s.series_id = o.series_id
    JOIN cpi.item   i ON i.item_code = s.item_code
    WHERE o.period BETWEEN 'M01' AND 'M12'
)
SELECT
    o.series_id, o.item_code, o.item_name, o.display_level, o.sort_sequence,
    o.seasonal, o.year, o.period, o.value,
    round((o.value / NULLIF(pm.value, 0) - 1) * 100, 2) AS mom_pct,
    round((o.value / NULLIF(py.value, 0) - 1) * 100, 2) AS yoy_pct
FROM obs o
LEFT JOIN obs pm ON pm.series_id = o.series_id AND pm.ord = o.ord - 1
LEFT JOIN obs py ON py.series_id = o.series_id AND py.ord = o.ord - 12;

COMMENT ON SCHEMA cpi IS 'BLS Consumer Price Index (survey cu). item/area/series dimensions + observation values; v_report computes MoM/YoY.';
