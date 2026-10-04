-- ============================================================================
-- econ_data :: PPI schema  (BLS Producer Price Index — survey code "wp")
-- ----------------------------------------------------------------------------
-- Structured mirror of the PPI Commodity/Final-Demand data, pulled from BLS
-- flat files. Same shape as the cpi schema, but PPI has NO area dimension:
-- it uses a GROUP + ITEM hierarchy instead. item_code is only unique WITHIN a
-- group, so ppi.item is keyed on (group_code, item_code).
--
-- Headline "Final Demand" PPI = group 'FD':
--   WPSFD4 (SA) / WPUFD4 (NSA) = Final demand, all.
--
-- Source flat files (no key): https://download.bls.gov/pub/time.series/wp/
--   wp.group  -> ppi.group       wp.item   -> ppi.item
--   wp.series -> ppi.series      wp.data.* -> ppi.observation
-- Series ID: WP + seasonal(S|U) + group_code(2) + item_code, e.g.
--   WPS 00 000000 = All commodities, seasonally adjusted.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS ppi;

-- --- Group dimension ---------------------------------------------------------
-- The top-level commodity groupings (Farm products, Fuels, Chemicals, ...) plus
-- the Final Demand-Intermediate Demand system (group 'FD', 'ID').
CREATE TABLE IF NOT EXISTS ppi.group (
    group_code      text PRIMARY KEY,
    group_name      text NOT NULL
);

-- --- Item dimension ----------------------------------------------------------
-- The commodity dictionary. item_code repeats across groups, so the key is
-- composite. Hierarchy depth is implied by item_code length within a group
-- (BLS ships no display_level for PPI).
CREATE TABLE IF NOT EXISTS ppi.item (
    group_code      text NOT NULL REFERENCES ppi.group(group_code),
    item_code       text NOT NULL,
    item_name       text NOT NULL,
    PRIMARY KEY (group_code, item_code)
);

-- --- Series dimension --------------------------------------------------------
-- One row per distinct series. seasonal: 'S' seasonally adjusted, 'U' not.
-- No composite FK to ppi.item on purpose: a few series reference codes absent
-- from the item dictionary, and a data mirror should not drop them. group_code
-- IS enforced (only 55 groups, always present).
CREATE TABLE IF NOT EXISTS ppi.series (
    series_id       text PRIMARY KEY,
    group_code      text REFERENCES ppi.group(group_code),
    item_code       text,
    seasonal        char(1),                    -- 'S' | 'U'
    base_date       text,
    series_title    text,
    footnote_codes  text,
    begin_year      int,
    begin_period    text,
    end_year        int,
    end_period      text
);
CREATE INDEX IF NOT EXISTS ix_ppi_series_group ON ppi.series(group_code);
CREATE INDEX IF NOT EXISTS ix_ppi_series_item ON ppi.series(item_code);
CREATE INDEX IF NOT EXISTS ix_ppi_series_seasonal ON ppi.series(seasonal);

-- --- Observations (the values) ----------------------------------------------
-- period: M01..M12 monthly, M13 = annual average; value NULL when withheld.
CREATE TABLE IF NOT EXISTS ppi.observation (
    series_id       text NOT NULL REFERENCES ppi.series(series_id),
    year            int  NOT NULL,
    period          text NOT NULL,              -- M01..M13
    value           numeric,                    -- index level; NULL if withheld
    footnote_codes  text,
    PRIMARY KEY (series_id, year, period)
);
CREATE INDEX IF NOT EXISTS ix_ppi_obs_period ON ppi.observation(year, period);

-- --- Report view: MoM / YoY per series --------------------------------------
-- Mirrors cpi.v_report. Monthly points only (excludes M13 annual average).
CREATE OR REPLACE VIEW ppi.v_report AS
WITH obs AS (
    SELECT o.series_id, s.group_code, s.item_code, i.item_name,
           s.seasonal, o.year, o.period, o.value,
           ((o.year * 12) + CAST(substring(o.period from 2) AS int)) AS ord
    FROM ppi.observation o
    JOIN ppi.series s ON s.series_id = o.series_id
    LEFT JOIN ppi.item i ON i.group_code = s.group_code AND i.item_code = s.item_code
    WHERE o.period BETWEEN 'M01' AND 'M12'
)
SELECT
    o.series_id, o.group_code, o.item_code, o.item_name,
    o.seasonal, o.year, o.period, o.value,
    round((o.value / NULLIF(pm.value, 0) - 1) * 100, 2) AS mom_pct,
    round((o.value / NULLIF(py.value, 0) - 1) * 100, 2) AS yoy_pct
FROM obs o
LEFT JOIN obs pm ON pm.series_id = o.series_id AND pm.ord = o.ord - 1
LEFT JOIN obs py ON py.series_id = o.series_id AND py.ord = o.ord - 12;

COMMENT ON SCHEMA ppi IS 'BLS Producer Price Index (survey wp). group/item/series dimensions + observation values; v_report computes MoM/YoY. Headline = group FD (WPSFD4/WPUFD4).';
