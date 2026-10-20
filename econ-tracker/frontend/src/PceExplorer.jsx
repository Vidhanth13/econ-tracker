import { useEffect, useMemo, useState } from "react";

// PCE — BEA Personal Consumption Expenditures. Its own tab: "what people spend
// money on." Two measures per line: spending ($, share of wallet) + the price
// index (inflation) on that same category. Pure DB -> API -> app, no LLM.
const j = (url) => fetch(url).then((r) => r.json());

const BLUE = "#58a6ff", GOOD = "#3fb950", HOT = "#f0883e", NEU = "#7d8590";
const ordOf = (ym) => { const [y, m] = ym.split("-").map(Number); return y * 12 + m; };

const fmtMoney = (m) => m == null ? "—"
  : m >= 1e6 ? `$${(m / 1e6).toFixed(2)}T` : `$${(m / 1e3).toFixed(0)}B`;
const signed = (v, s = "%") => v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(2) + s;
// inflation heat: at/below the Fed's 2% target = cool, above = hot
const priceColor = (v) => v == null ? NEU : v > 2 ? HOT : GOOD;
const growthColor = (v) => v == null ? NEU : v >= 0 ? BLUE : "#f85149";

export default function PceExplorer() {
  const [ov, setOv] = useState(null);
  const [bd, setBd] = useState(null);
  const [months, setMonths] = useState([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [line, setLine] = useState(1);              // selected category for the chart
  const [measure, setMeasure] = useState("D");      // D spending | P price
  const [sortBy, setSortBy] = useState("share");    // share | spend | price
  const [lookback, setLookback] = useState(12);      // 1 | 3 | 6 | 12 month window
  const [trend, setTrend] = useState(null);

  useEffect(() => { j("/api/pce/overview").then(setOv); }, []);
  useEffect(() => { setBd(null); j(`/api/pce/breakdown?lookback=${lookback}`).then(setBd); }, [lookback]);
  useEffect(() => {
    j("/api/pce/months").then((m) => {
      setMonths(m);
      if (m.length) { setTo(m[m.length - 1].value); setFrom(m[Math.max(0, m.length - 121)].value); }
    });
  }, []);
  useEffect(() => {
    if (!from || !to) return;
    j(`/api/pce/trend?line=${line}&measure=${measure}&from=${from}&to=${to}`).then(setTrend);
  }, [line, measure, from, to]);

  const rows = bd?.rows || [];
  const sorted = useMemo(() => {
    const r = rows.filter((x) => x.line !== 1);     // drop the total (it's the hero)
    if (sortBy === "spend") return [...r].sort((a, b) => (b.spend_win ?? -99) - (a.spend_win ?? -99));
    if (sortBy === "price") return [...r].sort((a, b) => (b.price_win ?? -99) - (a.price_win ?? -99));
    return [...r].sort((a, b) => (b.share_pct ?? -1) - (a.share_pct ?? -1));  // share = biggest → smallest
  }, [rows, sortBy]);
  const WIN = { 1: "1-month", 3: "3-month", 6: "6-month", 12: "12-month" };
  const maxShare = Math.max(1, ...rows.filter((x) => x.line !== 1).map((x) => x.share_pct || 0));
  const lineName = rows.find((r) => r.line === line)?.line_text
    || (line === 1 ? "Personal consumption expenditures (PCE)" : `Line ${line}`);

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div>
        <div className="text-sm text-slate-400 mb-2">
          What people spend money on · US, monthly, seasonally adjusted (annual rate)
          {ov?.month && <span className="text-slate-500"> · {ov.month}</span>}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(ov?.cards || []).map((c) => <HeroCard key={c.key} c={c} />)}
        </div>
      </div>

      {/* Trend */}
      <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-lg font-medium">{lineName}</div>
              <select value={line} onChange={(e) => setLine(Number(e.target.value))}
                className="bg-[#0d1117] border border-[#30363d] rounded-md px-2.5 py-1.5 text-sm min-w-[240px]">
                {rows.map((o) => (
                  <option key={o.line} value={o.line}>
                    {" ".repeat((o.display_level || 0) * 2)}{o.line_text}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {measure === "D" ? "spending, $ (annual rate) · YoY growth" : "price index · YoY inflation"}
              {from && to && <span className="text-slate-600"> · {mlabel(months, from)} → {mlabel(months, to)}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733]">
              {[["D", "Spending $"], ["P", "Price index"]].map(([m, lbl]) => (
                <button key={m} onClick={() => setMeasure(m)}
                  className={`px-2.5 py-1 rounded-md text-xs ${measure === m ? "bg-[#1f6feb] text-white" : "text-slate-400 hover:text-slate-200"}`}>{lbl}</button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <MonthSelect value={from} onChange={setFrom} options={months} />
              <span className="text-slate-600 text-sm">→</span>
              <MonthSelect value={to} onChange={setTo} options={months} />
            </div>
          </div>
        </div>
        <SingleLine points={trend?.points || []} color={measure === "D" ? BLUE : HOT} measure={measure} />
      </div>

      {/* Breakdown — what people spend on */}
      <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-5">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="text-lg font-medium">Where the money goes</div>
            <span className="text-xs text-slate-500">· {bd?.month || "…"} · total {fmtMoney(bd?.total_millions)}/yr · {WIN[lookback]} window</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733]">
              {[[1, "1M"], [3, "3M"], [6, "6M"], [12, "12M"]].map(([lb, lbl]) => (
                <button key={lb} onClick={() => setLookback(lb)}
                  className={`px-2.5 py-1 rounded-md text-xs ${lookback === lb ? "bg-[#1f6feb] text-white" : "text-slate-400 hover:text-slate-200"}`}>{lbl}</button>
              ))}
            </div>
            <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733]">
              {[["share", "Share of wallet"], ["spend", "Spend growth"], ["price", "Price change"]].map(([k, lbl]) => (
                <button key={k} onClick={() => setSortBy(k)}
                  className={`px-2.5 py-1 rounded-md text-xs ${sortBy === k ? "bg-[#30363d] text-white" : "text-slate-400 hover:text-slate-200"}`}>{lbl}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="text-xs text-slate-500 mb-4">
          <span className="text-slate-300">share</span> = % of total spending · <span style={{ color: BLUE }}>spend {WIN[lookback]}</span> = how fast spending grew ·
          <span style={{ color: HOT }}> price {WIN[lookback]}</span> = inflation on that category (hot &gt; 2% target) · click a row to chart it ↑
        </div>
        {bd === null
          ? <div className="text-slate-500 p-6 text-sm">Loading…</div>
          : <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
              {sorted.map((r) => (
                <button key={r.line} onClick={() => { setLine(r.line); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  className={`group w-full text-left ${line === r.line ? "bg-[#1f6feb1a] -mx-2 px-2 rounded-lg" : ""}`}>
                  <div className="flex items-center justify-between text-sm gap-3">
                    <span className={`truncate ${line === r.line ? "text-white" : "text-slate-300 group-hover:text-white"}`}
                      >{r.line_text}</span>
                    <span className="flex items-center gap-4 tabular-nums shrink-0 text-xs">
                      <span className="text-slate-400 w-14 text-right">{fmtMoney(r.spend_millions)}</span>
                      <span className="w-12 text-right font-semibold text-slate-100">{r.share_pct?.toFixed(1)}%</span>
                      <span className="w-20 text-right" style={{ color: growthColor(r.spend_win) }}>{signed(r.spend_win)} spd</span>
                      <span className="w-20 text-right" style={{ color: priceColor(r.price_win) }}>{signed(r.price_win)} prc</span>
                    </span>
                  </div>
                </button>
              ))}
            </div>}
      </div>

      <div className="text-center text-slate-600 text-xs mt-2">econ_data · BEA PCE (NIPA 2.8.5 dollars + 2.8.4 prices) · monthly SA · no LLM, pure DB → API → app</div>
    </div>
  );
}

const mlabel = (months, v) => months.find((m) => m.value === v)?.label || v;

function MonthSelect({ value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="bg-[#0d1117] border border-[#30363d] rounded-md px-2.5 py-1.5 text-sm">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function HeroCard({ c }) {
  const dollars = c.kind === "dollars";
  const big = dollars ? fmtMoney(c.level_millions) : (c.value_yoy == null ? "—" : c.value_yoy.toFixed(2));
  const sub = dollars
    ? <span style={{ color: growthColor(c.value_yoy) }}>{signed(c.value_yoy)} YoY · {signed(c.value_mom)} MoM</span>
    : <span className="text-slate-500">{signed(c.value_mom)} MoM</span>;
  const accent = dollars ? BLUE : priceColor(c.value_yoy);
  return (
    <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-4">
      <div className="flex items-start justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-500">{c.label}</div>
        <span className="w-2 h-2 rounded-full mt-1" style={{ background: accent }} />
      </div>
      <div className="text-3xl font-semibold tabular-nums mt-1" style={{ color: dollars ? "#e6edf3" : accent }}>
        {big}{dollars ? "" : "%"}
      </div>
      <div className="text-xs tabular-nums mt-1">{sub}</div>
      <div className="text-[11px] text-slate-500 mt-1 leading-tight">{c.blurb}</div>
    </div>
  );
}

function SingleLine({ points, color, measure }) {
  const [hover, setHover] = useState(null);
  const [mode, setMode] = useState("yoy");        // yoy | level
  const W = 900, H = 320, padL = 48, padR = 16, padT = 16, padB = 34;
  const pts = points.filter((p) => (mode === "yoy" ? p.yoy != null : p.value != null));
  if (!pts.length) return <div className="text-slate-500 p-8">No data for this range.</div>;

  const val = (p) => (mode === "yoy" ? p.yoy : p.value);
  const ords = pts.map((p) => ordOf(p.ym));
  const x0 = Math.min(...ords), x1 = Math.max(...ords);
  const vs = pts.map(val);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const yPad = (hi - lo) * 0.08 || 1;
  const yl = Math.min(lo - yPad, mode === "yoy" ? 0 : lo - yPad), yh = hi + yPad;
  const span = Math.max(1, x1 - x0);
  const X = (o) => padL + ((o - x0) / span) * (W - padL - padR);
  const Y = (v) => padT + (1 - (v - yl) / (yh - yl)) * (H - padT - padB);

  const ticks = 5;
  const grid = Array.from({ length: ticks + 1 }, (_, k) => yl + (k / ticks) * (yh - yl));
  const nLab = 7;
  const xlabs = Array.from({ length: nLab + 1 }, (_, k) => Math.round(x0 + (k / nLab) * span));
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const labOf = (o) => `${M[((o - 1) % 12)]} '${String(Math.floor((o - 1) / 12)).slice(2)}`;
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${X(ordOf(p.ym)).toFixed(1)} ${Y(val(p)).toFixed(1)}`).join(" ");

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const o = Math.round(x0 + ((mx - padL) / (W - padL - padR)) * span);
    setHover(Math.max(x0, Math.min(x1, o)));
  };
  const hp = hover == null ? null : pts.find((p) => ordOf(p.ym) === hover);
  const unit = mode === "yoy" ? "%" : (measure === "D" ? "" : "");
  const fmtY = (v) => mode === "yoy" ? v.toFixed(1) : (measure === "D" ? fmtMoney(v) : v.toFixed(1));

  return (
    <div>
      <div className="flex items-center justify-end mb-2">
        <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733]">
          {[["yoy", "YoY %"], ["level", measure === "D" ? "Level $" : "Index"]].map(([m, lbl]) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2.5 py-1 rounded-md text-xs ${mode === m ? "bg-[#1f6feb] text-white" : "text-slate-400 hover:text-slate-200"}`}>{lbl}</button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {grid.map((g, k) => (
          <g key={k}>
            <line x1={padL} x2={W - padR} y1={Y(g)} y2={Y(g)} stroke="#1e2733" />
            <text x={padL - 6} y={Y(g) + 4} textAnchor="end" fontSize="10" fill="#7d8590">{fmtY(g)}</text>
          </g>
        ))}
        {mode === "yoy" && yl < 0 && yh > 0 && <line x1={padL} x2={W - padR} y1={Y(0)} y2={Y(0)} stroke="#3b4654" />}
        {xlabs.map((o, k) => (
          <text key={k} x={X(o)} y={H - padB + 16} textAnchor="middle" fontSize="10" fill="#7d8590">{labOf(o)}</text>
        ))}
        <path d={path} fill="none" stroke={color} strokeWidth="2" />
        {hp && (
          <g>
            <line x1={X(hover)} x2={X(hover)} y1={padT} y2={H - padB} stroke="#3b4654" strokeDasharray="3 3" />
            <circle cx={X(hover)} cy={Y(val(hp))} r="3.5" fill={color} />
            <g transform={`translate(${Math.min(X(hover) + 10, W - 130)}, ${padT + 4})`}>
              <rect width="124" height="36" rx="6" fill="#0d1117" stroke="#30363d" />
              <text x="9" y="15" fontSize="10" fill="#e6edf3">{hp.label}</text>
              <text x="9" y="30" fontSize="11" fill={color} fontWeight="600">{fmtY(val(hp))}{unit}</text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}
