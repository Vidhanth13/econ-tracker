-- ============================================================================
-- econ_data :: cpi.release  (Layer 2 — expectations / consensus)
-- ----------------------------------------------------------------------------
-- The market-facing release record: actual vs forecast vs previous for the
-- headline & core inflation rates (MoM/YoY), keyed to the DATA month so it
-- joins onto cpi.observation / the release-history table.
-- Source: TradingView economic calendar (free). No LLM.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cpi.release (
    metric        text NOT NULL,   -- headline_mom | headline_yoy | core_mom | core_yoy
    data_year     int  NOT NULL,   -- the month the data describes
    data_period   text NOT NULL,   -- M01..M12
    release_date  date,            -- when it was published
    actual        numeric,
    forecast      numeric,
    previous      numeric,
    unit          text DEFAULT '%',
    PRIMARY KEY (metric, data_year, data_period)
);
CREATE INDEX IF NOT EXISTS ix_cpi_release_month ON cpi.release(data_year, data_period);

COMMENT ON TABLE cpi.release IS 'CPI consensus/actual/previous per release (TradingView calendar). surprise = actual - forecast.';
