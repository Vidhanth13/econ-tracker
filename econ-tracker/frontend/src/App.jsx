import { useEffect, useMemo, useState } from "react";
import {
  getMonths, getCategories, getTrend,
  getHeadline, getMomentum, getDrivers, getHistory,
  getJoltsOverview, getCesOverview, getPceOverview, getCalendar,
  getJournal, addJournal, patchJournal, delJournal,
} from "./api";
import LineChart from "./LineChart";
import PPIExplorer from "./PPIExplorer";
import JoltsExplorer from "./JoltsExplorer";
import PceExplorer from "./PceExplorer";
import CesExplorer from "./CesExplorer";

const UP = "#3fb950", DOWN = "#f85149";
const SURVEYS = {
  cpi: { label: "US CPI", headline: "SA0", hero: "Headline CPI", core: "Core CPI (ex food & energy)", source: "BLS CPI" },
  ppi: { label: "US PPI", headline: "FD4", hero: "Headline PPI (Final Demand)", core: "Core PPI (ex food & energy)", source: "BLS PPI · Final Demand" },
  jolts: { label: "US JOLTS", headline: null, hero: null, core: null, source: "BLS JOLTS · labor-market flows" },
  pce: { label: "US PCE", headline: null, hero: null, core: null, source: "BEA PCE · consumer spending + prices" },
  ces: { label: "US NFP", headline: null, hero: null, core: null, source: "BLS CES · nonfarm payrolls" },
};

// surveys that render their own dedicated explorer (not the CPI cockpit)
const SELF_RENDER = new Set(["jolts", "pce", "ces"]);

// Sidebar navigation — the suite shell.
const NAV_TOP = [
  { key: "overview", label: "Overview", icon: "◎" },
  { key: "calendar", label: "Calendar", icon: "▦" },
];
const NAV_SURVEYS = [
  { key: "cpi", label: "CPI", src: "BLS · CPI", sub: "Consumer prices" },
  { key: "ppi", label: "PPI", src: "BLS · PPI", sub: "Producer prices" },
  { key: "jolts", label: "Jobs · JOLTS", src: "BLS · JOLTS", sub: "Job openings & labour flows" },
  { key: "ces", label: "NFP · CES", src: "BLS · CES", sub: "Nonfarm payrolls" },
  { key: "pce", label: "PCE", src: "BEA · NIPA", sub: "Spending + prices" },
];
const SURVEY_KEYS = new Set(NAV_SURVEYS.map((s) => s.key));

// ── Suite shell: left sidebar + the active view ──────────────────────────
export default function App() {
  const [view, setView] = useState(() => new URLSearchParams(location.search).get("view") || "overview");
  return (
    <div className="flex min-h-screen bg-[#0a0d12]">
      <Sidebar view={view} setView={setView} />
      <main className="flex-1 min-w-0">
        {view === "overview" && <Overview setView={setView} />}
        {view === "calendar" && <Calendar />}
        {SURVEY_KEYS.has(view) && <SurveyDashboard key={view} survey={view} />}
      </main>
    </div>
  );
}

function Sidebar({ view, setView }) {
  const Item = ({ k, label, src, sub, icon }) => (
    <button onClick={() => setView(k)}
      className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-3 ${
        view === k ? "bg-[#1f6feb] text-white" : "text-slate-400 hover:text-slate-100 hover:bg-[#141b24]"}`}>
      {icon && <span className="text-base leading-none opacity-80">{icon}</span>}
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-tight">{label}</span>
        {src && <span className={`block text-[10px] uppercase tracking-wide leading-tight mt-0.5 ${view === k ? "text-blue-200" : "text-slate-500"}`}>{src}</span>}
        {sub && <span className={`block text-[11px] leading-tight ${view === k ? "text-blue-100" : "text-slate-600"}`}>{sub}</span>}
      </span>
    </button>
  );
  return (
    <aside className="w-56 shrink-0 border-r border-[#1e2733] bg-[#0d1117] px-3 py-5 flex flex-col gap-1 sticky top-0 h-screen">
      <div className="px-2 mb-4">
        <div className="text-lg font-semibold tracking-tight">Econ Tracker</div>
        <div className="text-[11px] text-slate-500">Release cockpit · DB → app</div>
      </div>
      {NAV_TOP.map((n) => <Item key={n.key} k={n.key} {...n} />)}
      <div className="text-[10px] uppercase tracking-wider text-slate-600 px-3 mt-4 mb-1">Data points</div>
      {NAV_SURVEYS.map((n) => <Item key={n.key} k={n.key} {...n} />)}
      <div className="mt-auto px-3 text-[10px] text-slate-600 leading-relaxed">no LLM · pure DB → API → app</div>
    </aside>
  );
}

function Placeholder({ title, note }) {
  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight mb-2">{title}</h1>
      <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-8 text-slate-400 text-sm">{note}</div>
    </div>
  );
}

// ── Overview: one glanceable tile per indicator ──────────────────────────
const SV = Object.fromEntries(NAV_SURVEYS.map((s) => [s.key, s]));
const metaOf = (k) => ({ title: SV[k].label, src: SV[k].src, what: SV[k].sub });
const fmtNum = (n) => n == null ? "—" : (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : (Math.round(n * 10) / 10).toLocaleString());

function Overview({ setView }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.all([
      getHeadline(null, "cpi").catch(() => null), getHistory(null, 24, "cpi").catch(() => []),
      getHeadline(null, "ppi").catch(() => null), getHistory(null, 24, "ppi").catch(() => []),
      getJoltsOverview().catch(() => null), getCesOverview().catch(() => null), getPceOverview().catch(() => null),
    ]).then((r) => { if (live) setD({ cpi: r[0], cpiH: r[1], ppi: r[2], ppiH: r[3], jolts: r[4], ces: r[5], pce: r[6] }); });
    return () => { live = false; };
  }, []);

  const sparkYoy = (hist) => (hist || []).slice().sort((a, b) => (a.ym < b.ym ? -1 : 1)).map((x) => x.yoy_pct).filter((v) => v != null);

  const priceTile = (key, hd, hist) => {
    const h = hd?.headline; const sm = surpriseMeta(h?.surprise_yoy);
    return { key, ...metaOf(key), month: h?.month,
      big: { label: "YoY (NSA)", value: h ? `${h.yoy_pct?.toFixed(2)}%` : "—", color: "#e6edf3" },
      subs: h ? [
        { label: "MoM (SA)", value: `${h.mom_pct >= 0 ? "+" : ""}${h.mom_pct?.toFixed(2)}%`, color: h.mom_pct >= 0 ? "#e6edf3" : "#3fb950" },
        { label: "vs consensus", value: `${sm.tag} ${h.surprise_yoy != null ? (h.surprise_yoy > 0 ? "+" : "") + h.surprise_yoy.toFixed(2) : "—"}`, color: sm.col },
      ] : [], spark: sparkYoy(hist), sparkColor: "#a371f7" };
  };
  const joltsTile = () => {
    const o = d?.jolts, c = o?.cards?.[0];
    return { key: "jolts", ...metaOf("jolts"), month: o?.month,
      big: { label: c?.label || "Job openings", value: c ? fmtNum(c.value) + (c.unit === "rate" ? "%" : "") : "—", color: "#e6edf3" },
      subs: c ? [{ label: "MoM Δ", value: `${c.mom_chg >= 0 ? "+" : ""}${fmtNum(c.mom_chg)}`, color: c.mom_chg >= 0 ? "#3fb950" : "#f85149" }] : [],
      spark: (c?.spark || []).map((p) => p.value), sparkColor: "#58a6ff" };
  };
  const cesTile = () => {
    const o = d?.ces, c = (o?.cards || []).find((x) => x.key === "nfp") || o?.cards?.[0];
    const wage = (o?.cards || []).find((x) => /earn|wage/i.test(x.key + x.label));
    return { key: "ces", ...metaOf("ces"), month: o?.month,
      big: { label: "Payrolls MoM · jobs added", value: c ? `${c.mom_chg >= 0 ? "+" : ""}${fmtNum(c.mom_chg)}K` : "—", color: c ? (c.mom_chg >= 0 ? "#3fb950" : "#f85149") : "#e6edf3" },
      subs: wage ? [{ label: `${wage.label} YoY`, value: `${wage.yoy_pct >= 0 ? "+" : ""}${wage.yoy_pct?.toFixed(2)}%`, color: "#e6edf3" }] : [],
      spark: (c?.spark || []).map((p) => p.value), sparkColor: "#3fb950" };
  };
  const pceTile = () => {
    const o = d?.pce, core = (o?.cards || []).find((x) => /core/i.test(x.label)), spend = (o?.cards || []).find((x) => x.key === "spend");
    return { key: "pce", ...metaOf("pce"), month: o?.month,
      big: { label: "Core PCE YoY", value: core ? `${core.value_yoy?.toFixed(2)}%` : "—", color: "#e6edf3" },
      subs: spend ? [{ label: "Spending YoY", value: `${spend.value_yoy >= 0 ? "+" : ""}${spend.value_yoy?.toFixed(2)}%`, color: "#e6edf3" }] : [],
      spark: null, sparkColor: "#58a6ff" };
  };

  const tiles = [priceTile("cpi", d?.cpi, d?.cpiH), priceTile("ppi", d?.ppi, d?.ppiH), joltsTile(), cesTile(), pceTile()];

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <p className="text-slate-500 text-sm mb-6">State of the economy at a glance · latest print per indicator · click a card to dive in</p>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {tiles.map((t) => <OvTile key={t.key} t={t} loading={!d} onClick={() => setView(t.key)} />)}
      </div>
      <div className="text-center text-slate-600 text-xs mt-8">econ_data · live from Postgres · no LLM, pure DB → API → app</div>
    </div>
  );
}

function OvTile({ t, loading, onClick }) {
  return (
    <button onClick={onClick}
      className="text-left bg-[#121821] border border-[#1e2733] rounded-xl p-5 hover:border-[#30426b] hover:bg-[#141c28] transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-sm font-semibold">{t.title}</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">{t.src} · {t.what}</div>
        </div>
        <div className="text-[11px] text-slate-500">{t.month || (loading ? "…" : "—")}</div>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] text-slate-500">{t.big.label}</div>
          <div className="text-3xl font-semibold tabular-nums" style={{ color: t.big.color }}>{t.big.value}</div>
        </div>
        {t.spark && t.spark.length > 1 && <Sparkline points={t.spark} color={t.sparkColor} />}
      </div>
      {t.subs?.length > 0 && (
        <div className="flex gap-5 mt-3 flex-wrap">
          {t.subs.map((s, i) => (
            <div key={i}>
              <div className="text-[11px] text-slate-500">{s.label}</div>
              <div className="text-sm font-medium tabular-nums" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

function Sparkline({ points, color = "#58a6ff", h = 32, w = 116 }) {
  const vals = (points || []).map(Number).filter((v) => !Number.isNaN(v));
  if (vals.length < 2) return <div style={{ width: w, height: h }} />;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const step = w / (vals.length - 1);
  const dpath = vals.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={dpath} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ── Calendar: economic releases (read from calendar.event via /api/calendar) ──
const IMPACT_COL = { High: "#f85149", Medium: "#f0883e", Low: "#6e7681", Holiday: "#6e7681" };
const saDay = (iso) => new Date(iso).toLocaleDateString("en-ZA", { weekday: "short", day: "2-digit", month: "short", timeZone: "Africa/Johannesburg" });
const saTime = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" });

function Calendar() {
  const [d, setD] = useState(null);
  const [wide, setWide] = useState(false); // false = US key events · true = all
  useEffect(() => {
    let live = true; setD(null);
    getCalendar(wide ? "all" : "USD", wide ? "" : "High,Medium").then((x) => { if (live) setD(x); });
    return () => { live = false; };
  }, [wide]);

  const group = (list) => {
    const g = []; let c = null;
    for (const e of (list || [])) {
      const day = saDay(e.event_at);
      if (!c || c.day !== day) { c = { day, items: [] }; g.push(c); }
      c.items.push(e);
    }
    return g;
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733]">
          {[["US · key", false], ["All", true]].map(([lbl, k]) => (
            <button key={lbl} onClick={() => setWide(k)}
              className={`px-3 py-1 rounded-md text-xs ${wide === k ? "bg-[#1f6feb] text-white" : "text-slate-400 hover:text-slate-200"}`}>{lbl}</button>
          ))}
        </div>
      </div>
      <p className="text-slate-500 text-sm mb-6">Economic releases · times in SAST · previous · forecast · actual</p>
      {!d ? <div className="text-slate-600 text-sm">Loading…</div> : <>
        <CalSection title="Upcoming" groups={group(d.upcoming)} empty="No upcoming events in range." />
        <CalSection title="Past" groups={group(d.past)} empty="No past events in range yet — history builds as releases print." dim />
      </>}
      <div className="text-center text-slate-600 text-xs mt-8">calendar.event · ingested from Forex Factory · read-only · no LLM</div>
    </div>
  );
}

function CalSection({ title, groups, empty, dim }) {
  return (
    <div className="mb-8">
      <div className="text-xs uppercase tracking-wider text-slate-500 mb-3">{title}</div>
      {groups.length === 0 ? <div className="text-slate-600 text-sm">{empty}</div> : (
        <div className={`space-y-5 ${dim ? "opacity-80" : ""}`}>
          {groups.map((g) => (
            <div key={g.day}>
              <div className="text-sm font-medium text-slate-300 mb-2">{g.day}</div>
              <div className="rounded-xl border border-[#1e2733] overflow-hidden">
                {g.items.map((e, i) => <EventRow key={i} e={e} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ e }) {
  const col = IMPACT_COL[e.impact] || "#6e7681";
  const sc = e.surprise == null ? "#7d8590" : e.surprise > 0 ? "#f0883e" : e.surprise < 0 ? "#58a6ff" : "#7d8590";
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-t border-[#1e2733] first:border-t-0 bg-[#121821]">
      <div className="w-12 text-sm tabular-nums text-slate-300">{saTime(e.event_at)}</div>
      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: col }} title={e.impact} />
      <div className="w-9 text-[11px] font-medium text-slate-500">{e.country}</div>
      <div className="flex-1 min-w-0 text-sm text-slate-200 truncate">{e.title}</div>
      <div className="hidden sm:flex items-center gap-4 text-xs tabular-nums">
        <CalCell label="Prev" v={e.previous} />
        <CalCell label="Fcst" v={e.forecast} />
        <CalCell label="Act" v={e.actual} strong />
        <div className="w-14 text-right" style={{ color: sc }}>{e.surprise == null ? "" : (e.surprise > 0 ? "+" : "") + e.surprise}</div>
      </div>
    </div>
  );
}

function CalCell({ label, v, strong }) {
  return (
    <div className="w-12 text-right">
      <div className="text-[9px] uppercase text-slate-600 leading-none">{label}</div>
      <div className={strong ? "text-slate-100 font-medium" : "text-slate-400"}>{v || "—"}</div>
    </div>
  );
}

function SurveyDashboard({ survey }) {
  const cfg = SURVEYS[survey];

  const [months, setMonths] = useState([]);
  const [cats, setCats] = useState([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [item, setItem] = useState(cfg.headline);
  const [metric, setMetric] = useState("yoy_pct");
  const [level, setLevel] = useState(1);

  const [headline, setHeadline] = useState(null);
  const [momentum, setMomentum] = useState(null);
  const [momPeriod, setMomPeriod] = useState("month"); // month | quarter | half
  const [drivers, setDrivers] = useState(null);
  const [lookback, setLookback] = useState(1);
  const [history, setHistory] = useState([]);
  const [trend, setTrend] = useState([]);

  // bootstrap — re-runs when the survey changes
  useEffect(() => {
    if (SELF_RENDER.has(survey)) { setMonths([]); setHeadline(null); return; }   // dedicated explorers self-fetch
    const hd = SURVEYS[survey].headline;
    setItem(hd);
    Promise.all([getMonths(survey), getCategories(survey), getHeadline(null, survey),
                 getMomentum(hd, 24, survey), getDrivers(1, lookback, null, survey), getHistory(null, 24, survey)])
      .then(([m, c, h, mo, dr, hi]) => {
        setMonths(m); setCats(c); setHeadline(h); setMomentum(mo); setDrivers(dr); setHistory(hi);
        if (m.length) { setTo(m[m.length - 1].value); setFrom(m[Math.max(0, m.length - 37)].value); }
      });
  }, [survey]);

  // trend follows item + range
  useEffect(() => {
    if (from && to) getTrend(item, from, to, survey).then(setTrend);
  }, [item, from, to, survey]);

  // drivers follow level + lookback window
  useEffect(() => { getDrivers(level, lookback, null, survey).then(setDrivers); }, [level, lookback]);

  const itemName = useMemo(() => cats.find((c) => c.item_code === item)?.item_name || item, [cats, item]);
  const label = (v) => months.find((m) => m.value === v)?.label || v;

  const ups = (drivers?.rows || []).filter((r) => r.mom_pct > 0);
  const downs = (drivers?.rows || []).filter((r) => r.mom_pct < 0).slice().reverse();
  const maxAbs = Math.max(0.1, ...(drivers?.rows || []).map((r) => Math.abs(r.mom_pct || 0)));

  const dir = momentum?.summary?.direction;
  const dirColor = dir === "accelerating" ? "#f0883e" : dir === "decelerating" ? "#3fb950" : "#7d8590";

  return (
    <div className="min-h-full max-w-7xl mx-auto px-5 py-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{cfg.label}</h1>
          <p className="text-slate-500 text-sm">{cfg.source}{months.length ? ` · ${months.length} months of history` : ""}</p>
        </div>
        <div className="flex items-center gap-3">
        {headline?.headline && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Latest print</span>
            <span className="px-3 py-1.5 rounded-lg bg-[#121821] border border-[#1e2733] text-sm font-medium">{headline.headline.month}</span>
            {dir && <span className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: dirColor + "22", color: dirColor }}>
              {dir === "accelerating" ? "▲ Accelerating" : dir === "decelerating" ? "▼ Decelerating" : "● Steady"}
            </span>}
          </div>
        )}
        </div>
      </div>

      {/* Row 1 — Headline hero (CPI/PPI cockpit only) */}
      {!SELF_RENDER.has(survey) && (
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          {headline?.headline && <HeroCard c={headline.headline} tag={cfg.hero} />}
          {headline?.core && <HeroCard c={headline.core} tag={cfg.core} />}
        </div>
      )}

      {/* PPI gets its own pipeline explorer */}
      {survey === "ppi" && <PPIExplorer />}

      {/* JOLTS gets its own labor-market view */}
      {survey === "jolts" && <JoltsExplorer />}

      {/* PCE gets its own consumer-spending view */}
      {survey === "pce" && <PceExplorer />}

      {survey === "ces" && <CesExplorer />}

      {/* CPI cockpit rows */}
      {survey === "cpi" && <>
      {/* Row 2 — Momentum */}
      {momentum && (() => {
        const PERIODS = { month: "monthly change (SA)", quarter: "quarter-over-quarter (SA)", half: "half-over-half (SA)" };
        const barData =
          momPeriod === "quarter" ? (momentum.quarters || []).map((q) => ({ key: q.label, label: q.label, value: q.chg_pct }))
          : momPeriod === "half" ? (momentum.halves || []).map((h) => ({ key: h.label, label: h.label, value: h.chg_pct }))
          : (momentum.series || []).map((m) => ({ key: m.ym, label: m.label, value: m.mom_pct }));
        return (
        <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-6 mb-4">
          <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
            <div>
              <div className="text-sm text-slate-400 mb-2">Inflation momentum · {PERIODS[momPeriod]}, last {barData.length}</div>
              <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733] w-fit">
                {[["month", "Monthly"], ["quarter", "Quarterly"], ["half", "Semi-annual"]].map(([p, lbl]) => (
                  <button key={p} onClick={() => setMomPeriod(p)}
                    className={`px-3 py-1 rounded-md text-xs ${momPeriod === p ? "bg-[#1f6feb] text-white" : "text-slate-400 hover:text-slate-200"}`}>{lbl}</button>
                ))}
              </div>
            </div>
            <div className="flex gap-5 text-sm">
              <Tile label="3-mo annualized" v={momentum.summary.ann3_pct} suffix="%" />
              <Tile label="MoM accel." v={momentum.summary.accel_mom} suffix=" pp" signed />
              <Tile label="YoY accel." v={momentum.summary.accel_yoy} suffix=" pp" signed />
            </div>
          </div>
          <MomentumBars data={barData} />
        </div>
        );
      })()}

      {/* Row 3 — Trend chart */}
      <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <div className="text-lg font-medium flex items-center gap-2">
                {itemName}
                {trend.length > 0 && trend[0].basis === "NSA" && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#1f2d3d] text-[#d29922] border border-[#3d2e12]"
                    title="Seasonally-adjusted data for this category only begins later at BLS. Showing the unadjusted (NSA) series so the full history is visible — read the YoY line, not MoM.">NSA · deep history</span>
                )}
              </div>
              <div className="text-xs text-slate-500">{label(from)} → {label(to)}</div>
            </div>
            <select value={item} onChange={(e) => setItem(e.target.value)}
              className="bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-sm min-w-[220px]">
              {cats.map((c) => <option key={c.item_code} value={c.item_code}>{" ".repeat(c.display_level * 2)}{c.item_name}</option>)}
            </select>
            <Select value={from} onChange={setFrom} options={months} />
            <span className="text-slate-600 pb-2">→</span>
            <Select value={to} onChange={setTo} options={months} />
          </div>
          <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733]">
            {[["yoy_pct", "YoY %"], ["mom_pct", "MoM %"], ["value", "Index"]].map(([m, lbl]) => (
              <button key={m} onClick={() => setMetric(m)}
                className={`px-3 py-1 rounded-md text-xs ${metric === m ? "bg-[#1f6feb] text-white" : "text-slate-400 hover:text-slate-200"}`}>{lbl}</button>
            ))}
          </div>
        </div>
        <LineChart data={trend} metric={metric} color={metric === "value" ? "#58a6ff" : "#a371f7"} />
      </div>

      {/* Row 4 — drivers (full width) */}
      <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-5 mb-4">
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <div className="text-lg font-medium">Category Breakdown <span className="text-xs text-slate-500">· % change per category over window</span></div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733]">
                {[[1, "1M"], [3, "3M"], [6, "6M"], [12, "12M"]].map(([lb, lbl]) => (
                  <button key={lb} onClick={() => setLookback(lb)}
                    className={`px-2.5 py-1 rounded-md text-xs ${lookback === lb ? "bg-[#1f6feb] text-white" : "text-slate-400 hover:text-slate-200"}`}>{lbl}</button>
                ))}
              </div>
              <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733]">
                {[[1, "Major"], [2, "Detailed"], [0, "All"]].map(([lv, lbl]) => (
                  <button key={String(lv)} onClick={() => setLevel(lv)}
                    className={`px-2.5 py-1 rounded-md text-xs ${level === lv ? "bg-[#30363d] text-white" : "text-slate-400 hover:text-slate-200"}`}>{lbl}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="text-xs text-slate-500 mb-4">{drivers?.from_label} → {drivers?.month}</div>
          <div className="grid grid-cols-2 gap-5">
            <DriverList title="Pushed up" rows={ups} color={UP} maxAbs={maxAbs} onPick={setItem} cats={cats} />
            <DriverList title="Pulled down" rows={downs} color={DOWN} maxAbs={maxAbs} onPick={setItem} cats={cats} />
          </div>
        </div>

        <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-5">
          <div className="text-lg font-medium mb-4">Release history <span className="text-xs text-slate-500">· headline {survey.toUpperCase()}</span></div>
          <div className="max-h-[380px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-500 text-xs sticky top-0 bg-[#121821]">
                <tr><th className="text-left py-2">Month</th><th className="text-right">Index</th><th className="text-right">MoM</th><th className="text-right">YoY</th><th className="text-right">Cons. YoY</th><th className="text-right pr-1">Surprise</th></tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const sm = surpriseMeta(h.surprise_yoy);
                  return (
                  <tr key={h.ym} className="border-t border-[#1e2733]">
                    <td className="py-2 text-slate-300">{h.label}</td>
                    <td className="text-right tabular-nums text-slate-400">{h.index.toFixed(1)}</td>
                    <td className="text-right tabular-nums font-medium" style={{ color: h.mom_pct >= 0 ? UP : DOWN }}>{h.mom_pct >= 0 ? "+" : ""}{h.mom_pct?.toFixed(2)}%</td>
                    <td className="text-right tabular-nums font-medium text-slate-200">{h.yoy_pct?.toFixed(2)}%</td>
                    <td className="text-right tabular-nums text-slate-500">{h.cons_yoy != null ? h.cons_yoy.toFixed(1) + "%" : "—"}</td>
                    <td className="text-right tabular-nums font-medium pr-1" style={{ color: sm.col }}>{h.surprise_yoy != null ? sm.tag + " " + (h.surprise_yoy > 0 ? "+" : "") + h.surprise_yoy.toFixed(2) : "—"}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>}

      <Journal survey={survey} />

      <div className="text-center text-slate-600 text-xs mt-6">econ_data · {cfg.source} · SA for MoM · NSA for YoY · no LLM, pure DB → API → app</div>
    </div>
  );
}

// ── Journal: per-dashboard notes / positioning (the app's only writes) ──
function Journal({ survey }) {
  const [list, setList] = useState([]);
  const [note, setNote] = useState("");
  const [topic, setTopic] = useState("");
  const [pos, setPos] = useState("");
  const [editId, setEditId] = useState(null);
  const [open, setOpen] = useState(false);

  const load = () => getJournal(survey).then(setList);
  const resetForm = () => { setNote(""); setTopic(""); setPos(""); setEditId(null); };
  useEffect(() => { load(); resetForm(); setOpen(false); }, [survey]);

  const save = async () => {
    if (!note.trim()) return;
    if (editId) await patchJournal(editId, { note, topic, position: pos });
    else await addJournal({ survey, note, topic, position: pos });
    resetForm(); setOpen(false); load();
  };
  const startEdit = (e) => { setEditId(e.id); setNote(e.note); setTopic(e.topic || ""); setPos(e.position || ""); setOpen(true); };
  const remove = async (id) => { await delJournal(id); if (editId === id) resetForm(); load(); };
  const fmt = (iso) => new Date(iso).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });

  return (
    <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-5 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-lg font-medium">Journal <span className="text-xs text-slate-500">· your thoughts & positioning on {survey.toUpperCase()}</span></div>
        <button onClick={() => { resetForm(); setOpen(!open); }}
          className="text-xs px-3 py-1.5 rounded-md bg-[#1f6feb] text-white font-medium">{open ? "Close" : "+ New entry"}</button>
      </div>

      {open && (
        <div className="bg-[#0d1117] border border-[#1e2733] rounded-lg p-4 mb-4 space-y-3">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
            placeholder="What are you seeing in the data? e.g. eggs climbing — research top producers & supply chain…"
            className="w-full bg-[#121821] border border-[#30363d] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#1f6feb]" />
          <div className="flex gap-3 flex-wrap">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic tag (e.g. eggs)"
              className="flex-1 min-w-[160px] bg-[#121821] border border-[#30363d] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#1f6feb]" />
            <input value={pos} onChange={(e) => setPos(e.target.value)} placeholder="Position idea (e.g. watch CALM)"
              className="flex-1 min-w-[160px] bg-[#121821] border border-[#30363d] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#1f6feb]" />
          </div>
          <div className="flex gap-2">
            <button onClick={save} className="text-xs px-4 py-2 rounded-md bg-[#238636] text-white font-medium">{editId ? "Update" : "Save entry"}</button>
            <button onClick={() => { resetForm(); setOpen(false); }} className="text-xs px-4 py-2 rounded-md text-slate-400 hover:text-slate-200">Cancel</button>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <div className="text-slate-600 text-sm">No entries yet. Capture your read on {survey.toUpperCase()} — it threads into the trading system.</div>
      ) : (
        <div className="space-y-3">
          {list.map((e) => (
            <div key={e.id} className="border border-[#1e2733] rounded-lg p-4 bg-[#0d1117]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {e.topic && <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#1f2d3d] text-[#58a6ff] font-medium">#{e.topic}</span>}
                  <span className="text-[11px] text-slate-600">{fmt(e.created_at)}</span>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => startEdit(e)} className="text-[11px] text-slate-500 hover:text-slate-200">Edit</button>
                  <button onClick={() => remove(e.id)} className="text-[11px] text-slate-500 hover:text-[#f85149]">Delete</button>
                </div>
              </div>
              <div className="text-sm text-slate-200 mt-2 whitespace-pre-wrap">{e.note}</div>
              {e.position && <div className="text-xs text-[#3fb950] mt-2">▸ Position: {e.position}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HeroCard({ c, tag }) {
  const momAccel = c.prev_mom_pct != null ? c.mom_pct - c.prev_mom_pct : null;
  const yoyAccel = c.prev_yoy_pct != null ? c.yoy_pct - c.prev_yoy_pct : null;
  return (
    <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-5">
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">{tag} · {c.month}</div>
      <div className="grid grid-cols-2 gap-4">
        <Stat label="MoM (SA)" value={c.mom_pct} accel={momAccel} big />
        <Stat label="YoY (NSA)" value={c.yoy_pct} accel={yoyAccel} big />
      </div>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <SurpriseTag label="YoY" actual={c.actual_yoy} cons={c.cons_yoy} surprise={c.surprise_yoy} />
        <SurpriseTag label="MoM" actual={c.actual_mom} cons={c.cons_mom}
          surprise={c.actual_mom != null && c.cons_mom != null ? +(c.actual_mom - c.cons_mom).toFixed(2) : null} />
      </div>
      <div className="text-xs text-slate-500 mt-2">Index {c.index.toFixed(1)} · prior MoM {c.prev_mom_pct?.toFixed(2)}% · prior YoY {c.prev_yoy_pct?.toFixed(2)}%</div>
    </div>
  );
}

// Inflation surprise: hotter than expected = hawkish (amber), cooler = green.
function surpriseMeta(s) {
  if (s == null) return { txt: "no consensus", col: "#7d8590", tag: "—" };
  if (s > 0.001) return { txt: `+${s.toFixed(2)} hotter`, col: "#f0883e", tag: "▲" };
  if (s < -0.001) return { txt: `${s.toFixed(2)} cooler`, col: "#3fb950", tag: "▼" };
  return { txt: "in line", col: "#7d8590", tag: "=" };
}

function SurpriseTag({ label, actual, cons, surprise }) {
  const m = surpriseMeta(surprise);
  return (
    <span className="text-xs px-2 py-1 rounded-md bg-[#0d1117] border border-[#1e2733]">
      <span className="text-slate-500">{label} vs cons {cons != null ? cons.toFixed(cons % 1 ? 2 : 1) + "%" : "—"} · </span>
      <span style={{ color: m.col }}>{m.tag} {m.txt}</span>
    </span>
  );
}

function Stat({ label, value, accel, big }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`${big ? "text-3xl" : "text-xl"} font-semibold tabular-nums`}>
        {value >= 0 ? "+" : ""}{value?.toFixed(2)}%
      </div>
      {accel != null && (
        <div className="text-xs tabular-nums" style={{ color: accel > 0 ? "#f0883e" : accel < 0 ? "#3fb950" : "#7d8590" }}>
          {accel > 0 ? "▲" : accel < 0 ? "▼" : "●"} {accel > 0 ? "+" : ""}{accel.toFixed(2)}pp vs prior
        </div>
      )}
    </div>
  );
}

function Tile({ label, v, suffix = "", signed }) {
  const col = signed ? (v > 0 ? "#f0883e" : v < 0 ? "#3fb950" : "#e6edf3") : "#e6edf3";
  return (
    <div className="text-right">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-base font-semibold tabular-nums" style={{ color: col }}>
        {v == null ? "—" : (signed && v > 0 ? "+" : "") + v.toFixed(2) + suffix}
      </div>
    </div>
  );
}

function MomentumBars({ data }) {
  const W = 1200, H = 190, pad = 24, gap = data.length > 14 ? 4 : 6;
  const vals = data.map((d) => d.value ?? 0);
  const max = Math.max(0.1, ...vals.map(Math.abs));
  const bw = (W - pad * 2) / Math.max(1, data.length) - gap;
  const zero = H / 2 + 8;
  const dense = data.length > 14;
  return (
    <svg viewBox={`0 0 ${W} ${H + 8}`} className="w-full">
      <line x1={pad} x2={W - pad} y1={zero} y2={zero} stroke="#30363d" />
      {data.map((d, i) => {
        const v = d.value ?? 0;
        const h = (Math.abs(v) / max) * (H / 2 - 24);
        const x = pad + i * (bw + gap);
        const y = v >= 0 ? zero - h : zero;
        const showVal = true;                 // always print the number — no half-empty bars
        const showLbl = !dense || i % 2 === 0; // thin axis labels only when crowded
        const [t1, t2] = d.label.split(" ");
        return (
          <g key={d.key}>
            <rect x={x} y={y} width={bw} height={h} rx="2" fill={v >= 0 ? UP : DOWN} />
            {showVal && d.value != null && <text x={x + bw / 2} y={v >= 0 ? y - 4 : y + h + 11} textAnchor="middle" fontSize="9.5" fill="#7d8590">{v >= 0 ? "+" : ""}{v.toFixed(2)}</text>}
            {showLbl && <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="9" fill="#586069">{t1}</text>}
            {showLbl && <text x={x + bw / 2} y={H + 4} textAnchor="middle" fontSize="7.5" fill="#3d444d">{t2?.length > 2 ? t2.slice(2) : t2}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function DriverList({ title, rows, color, maxAbs, onPick, cats }) {
  const has = (code) => cats.some((c) => c.item_code === code);
  return (
    <div>
      <div className="text-sm text-slate-400 mb-2">{title}</div>
      <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
        {rows.map((r) => (
          <button key={r.item_code} onClick={() => has(r.item_code) && onPick(r.item_code)} className="w-full text-left group">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-300 group-hover:text-white truncate pr-2">{r.item_name}</span>
              <span style={{ color }} className="font-semibold tabular-nums">{r.mom_pct > 0 ? "+" : ""}{r.mom_pct.toFixed(2)}%</span>
            </div>
            <div className="h-1.5 bg-[#0d1117] rounded mt-1 overflow-hidden">
              <div style={{ width: `${(Math.abs(r.mom_pct) / maxAbs) * 100}%`, background: color }} className="h-full rounded" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-sm">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
