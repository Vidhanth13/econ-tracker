-- ============================================================================
-- econ_data :: PCE schema  (BEA Personal Consumption Expenditures)
-- ----------------------------------------------------------------------------
-- The PCE tab answers "what are people spending money on?" — so we hold BOTH
-- sides of the survey, joined by line:
--   measure 'D' = current-dollar spending level  (BEA table 2.8.5, series *RC)
--   measure 'P' = Fisher chain-type price index  (BEA table 2.8.4, series *RG)
-- Both monthly, seasonally adjusted (dollars are annual rates / SAAR), 1959->.
--
-- The two tables share an identical 31-line goods->services structure (same
-- LineNumber + description), so pce.line is keyed on line_number and carries
-- the series code for each measure. Shares (% of wallet) and growth come from
-- pce.v_report.
--
-- Headline PCE = line 1.  Core (ex food & energy) = line 25.
-- Supercore (services ex energy & housing) = line 28.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS pce;

-- --- Line dimension ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS pce.line (
    line_number     int  PRIMARY KEY,            -- position in tables 2.8.4/2.8.5
    line_text       text NOT NULL,               -- LineDescription
    spend_code      text,                         -- BEA SeriesCode, dollars (e.g. DPCERC)
    price_code      text,                         -- BEA SeriesCode, price index (e.g. DPCERG)
    display_level   int  NOT NULL DEFAULT 0,     -- indentation depth
    parent_line     int  REFERENCES pce.line(line_number),
    is_addendum     boolean NOT NULL DEFAULT false
);

-- --- Observations (both measures) -------------------------------------------
-- measure 'D' = current dollars (millions, SAAR); 'P' = price index level.
CREATE TABLE IF NOT EXISTS pce.observation (
    line_number     int  NOT NULL REFERENCES pce.line(line_number),
    measure         char(1) NOT NULL,            -- 'D' dollars | 'P' price index
    year            int  NOT NULL,
    period          text NOT NULL,               -- M01..M12
    value           numeric,
    PRIMARY KEY (line_number, measure, year, period)
);
CREATE INDEX IF NOT EXISTS ix_pce_obs_period ON pce.observation(year, period);
CREATE INDEX IF NOT EXISTS ix_pce_obs_measure ON pce.observation(measure);

-- --- Report view: MoM / YoY + share of total PCE ----------------------------
-- share = this line's dollars / total-PCE (line 1) dollars that month, %.
-- Only meaningful for measure 'D', but computed harmlessly for both.
CREATE OR REPLACE VIEW pce.v_report AS
WITH obs AS (
    SELECT o.line_number, l.line_text, l.display_level, l.is_addendum,
           o.measure, o.year, o.period, o.value,
           ((o.year * 12) + CAST(substring(o.period from 2) AS int)) AS ord
    FROM pce.observation o
    JOIN pce.line l ON l.line_number = o.line_number
    WHERE o.period BETWEEN 'M01' AND 'M12'
),
tot AS (   -- total PCE dollars per month (line 1, measure D)
    SELECT ord, value AS total FROM obs WHERE line_number = 1 AND measure = 'D'
)
SELECT
    o.line_number, o.line_text, o.display_level, o.is_addendum,
    o.measure, o.year, o.period, o.value,
    round((o.value / NULLIF(pm.value, 0) - 1) * 100, 2) AS mom_pct,
    round((o.value / NULLIF(py.value, 0) - 1) * 100, 2) AS yoy_pct,
    round((o.value / NULLIF(t.total, 0)) * 100, 2)       AS share_pct
FROM obs o
LEFT JOIN obs pm ON pm.line_number = o.line_number AND pm.measure = o.measure AND pm.ord = o.ord - 1
LEFT JOIN obs py ON py.line_number = o.line_number AND py.measure = o.measure AND py.ord = o.ord - 12
LEFT JOIN tot t  ON t.ord = o.ord;

COMMENT ON SCHEMA pce IS 'BEA PCE (NIPA 2.8.5 dollars + 2.8.4 price index), two-measure. line dimension + observation(measure D/P); v_report computes MoM/YoY + share of wallet. Headline=line1, core=line25, supercore=line28. Monthly SA, 1959->.';
