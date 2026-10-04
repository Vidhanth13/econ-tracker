import { useEffect, useMemo, useState } from "react";

// JOLTS — labor-market flows. Its own view (not the price-index cockpit):
// the story is the rate/level and its POINT change, plus the openings-vs-quits
// read and the openings-per-unemployed slack gauge.
const j = (url) => fetch(url).then((r) => r.json());

// per-metric direction semantics: is a RISE a sign of strength?
const META = {
  openings:    { color: "#58a6ff", goodUp: true,  unitTxt: "% of employment" },
  hires:       { color: "#a371f7", goodUp: true,  unitTxt: "% of employment" },
  quits:       { color: "#3fb950", goodUp: true,  unitTxt: "% of employment" },
  layoffs:     { color: "#f85149", goodUp: false, unitTxt: "% of employment" },
  separations: { color: "#d29922", goodUp: null,  unitTxt: "% of employment" },
  slack:       { color: "#ec6547", goodUp: false, unitTxt: "ratio" },
};
const GOOD = "#3fb950", BAD = "#f85149", NEU = "#7d8590";

const ordOf = (ym) => { const [y, m] = ym.split("-").map(Number); return y * 12 + m; };

export default function JoltsExplorer() {
  const [ov, setOv] = useState(null);
  const [trend, setTrend] = useState(null);
  const [ind, setInd] = useState(null);
  const [indKey, setIndKey] = useState("openings");
  const [months, setMonths] = useState([]);           // {value,label} for the From/To pickers
  const [from, setFrom] = useState("");               // trend window start (ym)
  const [to, setTo] = useState("");                   // trend window end (ym)
  const [lines, setLines] = useState({ openings: true, quits: true, hires: true, layoffs: false });
  const [industry, setIndustry] = useState("000000"); // trend scope
  const [indList, setIndList] = useState([]);         // industry options for the picker

  useEffect(() => { j("/api/jolts/overview").then(setOv); }, []);
  useEffect(() => { j("/api/jolts/industry?key=openings").then((d) => setIndList(d.rows || [])); }, []);
  useEffect(() => {
    j("/api/jolts/months").then((m) => {
      setMonths(m);
      if (m.length) { setTo(m[m.length - 1].value); setFrom(m[Math.max(0, m.length - 121)].value); }
    });
  }, []);
  useEffect(() => {
    if (!from || !to) return;
    const keys = Object.keys(lines).filter((k) => lines[k]).join(",") || "openings";
    j(`/api/jolts/trend?keys=${keys}&industry=${industry}&from=${from}&to=${to}`).then(setTrend);
  }, [lines, industry, from, to]);
  useEffect(() => {
    let alive = true;                 // ignore a superseded response (StrictMode/rapid toggle)
    setInd(null);
    j(`/api/jolts/industry?key=${indKey}`).then((d) => { if (alive) setInd(d); });
    return () => { alive = false; };
  }, [indKey]);

  return (
    <div className="space-y-4">
      {/* Hero tiles */}
      <div>
        <div className="text-sm text-slate-400 mb-2">
          Labor-market flows · Total nonfarm, US, seasonally adjusted
          {ov?.month && <span className="text-slate-500"> · {ov.month}</span>}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {(ov?.cards || []).map((c) => <FlowCard key={c.key} c={c} />)}
        </div>
      </div>

      {/* Trend — the openings vs quits vs hires read */}
      <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-lg font-medium">Flow rates over time</div>
              <select value={industry} onChange={(e) => setIndustry(e.target.value)}
                className="bg-[#0d1117] border border-[#30363d] rounded-md px-2.5 py-1.5 text-sm min-w-[220px]">
                {indList.map((o) => (
                  <option key={o.industry_code} value={o.industry_code}>
                    {" ".repeat((o.display_level || 0) * 2)}{o.industry_text}
                  </option>
                ))}
              </select>
              {industry !== "000000" && (
                <button onClick={() => setIndustry("000000")}
                  className="text-xs text-slate-400 hover:text-slate-200 underline">reset</button>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              rate = % of employment · the classic "is the labor market loosening" read
              {from && to && <span className="text-slate-600"> · {mlabel(months, from)} → {mlabel(months, to)}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733]">
              {Object.keys(META).filter((k) => k !== "separations").map((k) => (
                <button key={k} onClick={() => setLines((s) => ({ ...s, [k]: !s[k] }))}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium ${lines[k] ? "text-white" : "text-slate-500 hover:text-slate-300"}`}
                  style={lines[k] ? { background: META[k].color + "33", color: META[k].color } : {}}>
                  {label(k)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <MonthSelect value={from} onChange={setFrom} options={months} />
              <span className="text-slate-600 text-sm">→</span>
              <MonthSelect value={to} onChange={setTo} options={months} />
            </div>
          </div>
        </div>
        <MultiLine series={trend?.series || []} />
      </div>

      {/* Breakdown by industry — what's picking up vs slowing down */}
      <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-5">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="text-lg font-medium">By industry — movers</div>
            <span className="text-xs text-slate-500">· {ind?.month || "…"}</span>
          </div>
          <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733]">
            {["openings", "hires", "quits", "layoffs"].map((k) => (
              <button key={k} onClick={() => setIndKey(k)}
                className={`px-2.5 py-1 rounded-md text-xs ${indKey === k ? "bg-[#30363d] text-white" : "text-slate-400 hover:text-slate-200"}`}>{label(k)}</button>
            ))}
          </div>
        </div>
        <div className="text-xs text-slate-500 mb-4">
          ranked by change vs prior month (SA) · <span style={{ color: GOOD }}>picking up</span> / <span style={{ color: BAD }}>slowing down</span> coloured by what it means for {label(indKey).toLowerCase()}
          <span className="text-slate-600"> · click a row to chart it over time ↑</span>
        </div>
        {ind === null
          ? <div className="text-slate-500 p-6 text-sm">Loading…</div>
          : <MoversGrid rows={ind.rows || []} goodUp={META[indKey]?.goodUp}
              onPick={(code) => { setIndustry(code); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              active={industry} />}
      </div>

      <div className="text-center text-slate-600 text-xs mt-2">econ_data · BLS JOLTS (survey jt) · rates seasonally adjusted · no LLM, pure DB → API → app</div>
    </div>
  );
}

function label(k) {
  return { openings: "Openings", hires: "Hires", quits: "Quits", layoffs: "Layoffs",
           separations: "Separations", slack: "Slack" }[k] || k;
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

// color a point-change by whether it signals strength for THIS metric
function chgColor(v, goodUp) {
  if (v == null || Math.abs(v) < 0.001 || goodUp == null) return NEU;
  const up = v > 0;
  return (up === goodUp) ? GOOD : BAD;
}

function FlowCard({ c }) {
  const m = META[c.key] || {};
  const mc = chgColor(c.mom_chg, m.goodUp);
  const yc = chgColor(c.yoy_chg, m.goodUp);
  const isRatio = c.unit === "ratio";
  return (
    <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-4">
      <div className="flex items-start justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-500">{c.label}</div>
        <span className="w-2 h-2 rounded-full mt-1" style={{ background: m.color }} />
      </div>
      <div className="flex items-end gap-2 mt-1">
        <div className="text-3xl font-semibold tabular-nums">{c.value.toFixed(isRatio ? 1 : 1)}{isRatio ? "" : "%"}</div>
        {c.level != null && <div className="text-xs text-slate-500 pb-1.5">{fmtK(c.level)}</div>}
      </div>
      <div className="flex items-center gap-3 mt-1 text-xs tabular-nums">
        <span style={{ color: mc }}>{arrow(c.mom_chg)} {signed(c.mom_chg)} MoM</span>
        <span style={{ color: yc }}>{arrow(c.yoy_chg)} {signed(c.yoy_chg)} YoY</span>
      </div>
      <Spark points={c.spark} color={m.color} />
      <div className="text-[11px] text-slate-500 mt-1 leading-tight">{c.blurb}</div>
    </div>
  );
}

const arrow = (v) => (v == null || Math.abs(v) < 0.001 ? "●" : v > 0 ? "▲" : "▼");
const signed = (v) => (v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1) + "pp");
const fmtK = (v) => (v >= 1000 ? (v / 1000).toFixed(2) + "M" : Math.round(v) + "K");

function Spark({ points, color }) {
  if (!points || points.length < 2) return <div className="h-8 mt-2" />;
  const W = 240, H = 32;
  const vs = points.map((p) => p.value);
  const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const X = (i) => (i / (points.length - 1)) * W;
  const Y = (v) => H - ((v - lo) / span) * (H - 4) - 2;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${X(i).toFixed(1)} ${Y(p.value).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-8 mt-2" preserveAspectRatio="none">
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
      <circle cx={X(points.length - 1)} cy={Y(points[points.length - 1].value)} r="2" fill={color} />
    </svg>
  );
}

function MultiLine({ series }) {
  const [hover, setHover] = useState(null);
  const W = 900, H = 340, padL = 44, padR = 16, padT = 16, padB = 34;
  const active = series.filter((s) => s.points && s.points.length);
  if (!active.length) return <div className="text-slate-500 p-8">Select at least one metric.</div>;

  // x-domain = full span the server returned (already windowed by From/To)
  const allOrds = active.flatMap((s) => s.points.map((p) => ordOf(p.ym)));
  const x0 = Math.min(...allOrds), x1 = Math.max(...allOrds);
  const inWin = () => true;

  const winPts = active.flatMap((s) => s.points.map((p) => p.value));
  const lo = Math.min(...winPts), hi = Math.max(...winPts);
  const yPad = (hi - lo) * 0.08 || 0.2;
  const yl = lo - yPad, yh = hi + yPad;
  const span = Math.max(1, x1 - x0);
  const X = (o) => padL + ((o - x0) / span) * (W - padL - padR);
  const Y = (v) => padT + (1 - (v - yl) / (yh - yl)) * (H - padT - padB);

  const ticks = 5;
  const grid = Array.from({ length: ticks + 1 }, (_, k) => yl + (k / ticks) * (yh - yl));
  const nLab = 7;
  const xlabs = Array.from({ length: nLab + 1 }, (_, k) => Math.round(x0 + (k / nLab) * span));
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const labOf = (o) => `${M[((o - 1) % 12)]} '${String(Math.floor((o - 1) / 12)).slice(2)}`;

  // hover: nearest month, values of every active series at that month
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const o = Math.round(x0 + ((mx - padL) / (W - padL - padR)) * span);
    setHover(Math.max(x0, Math.min(x1, o)));
  };
  const hoverVals = hover == null ? [] : active.map((s) => {
    const p = s.points.find((pp) => ordOf(pp.ym) === hover);
    return p ? { key: s.key, label: s.label, value: p.value, color: META[s.key]?.color } : null;
  }).filter(Boolean);

  return (
    <div>
      <div className="flex gap-4 mb-2 flex-wrap">
        {active.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="w-3 h-0.5 rounded" style={{ background: META[s.key]?.color }} />{s.label}
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {grid.map((g, k) => (
          <g key={k}>
            <line x1={padL} x2={W - padR} y1={Y(g)} y2={Y(g)} stroke="#1e2733" />
            <text x={padL - 6} y={Y(g) + 4} textAnchor="end" fontSize="11" fill="#7d8590">{g.toFixed(1)}</text>
          </g>
        ))}
        {xlabs.map((o, k) => (
          <text key={k} x={X(o)} y={H - padB + 16} textAnchor="middle" fontSize="10" fill="#7d8590">{labOf(o)}</text>
        ))}
        {active.map((s) => {
          const pts = s.points.filter((p) => inWin(ordOf(p.ym)));
          const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${X(ordOf(p.ym)).toFixed(1)} ${Y(p.value).toFixed(1)}`).join(" ");
          return <path key={s.key} d={path} fill="none" stroke={META[s.key]?.color} strokeWidth="2" />;
        })}
        {hover != null && hoverVals.length > 0 && (
          <g>
            <line x1={X(hover)} x2={X(hover)} y1={padT} y2={H - padB} stroke="#3b4654" strokeDasharray="3 3" />
            {hoverVals.map((v) => <circle key={v.key} cx={X(hover)} cy={Y(v.value)} r="3.5" fill={v.color} />)}
            <g transform={`translate(${Math.min(X(hover) + 10, W - 130)}, ${padT + 4})`}>
              <rect width="122" height={18 + hoverVals.length * 16} rx="6" fill="#0d1117" stroke="#30363d" />
              <text x="9" y="15" fontSize="10" fill="#e6edf3">{labOf(hover)}</text>
              {hoverVals.map((v, i) => (
                <text key={v.key} x="9" y={31 + i * 16} fontSize="11" fill={v.color} fontWeight="600">
                  {v.label}: {v.value.toFixed(1)}
                </text>
              ))}
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

// Two ranked columns: industries whose rate rose vs fell this month.
// "picking up" / "slowing down" are about DIRECTION OF CHANGE; the colour still
// reflects whether that move is good or bad for the chosen metric (goodUp).
function MoversGrid({ rows, goodUp, onPick, active }) {
  const data = rows.filter((r) => r.industry_code !== "000000"  // drop the Total-nonfarm aggregate
    && r.mom_chg != null && Math.abs(r.mom_chg) >= 0.001);
  const maxMag = Math.max(0.1, ...data.map((r) => Math.abs(r.mom_chg)));
  const up = data.filter((r) => r.mom_chg > 0).sort((a, b) => b.mom_chg - a.mom_chg);
  const down = data.filter((r) => r.mom_chg < 0).sort((a, b) => a.mom_chg - b.mom_chg);

  const Col = ({ title, items, empty }) => (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">{title} <span className="text-slate-600">· {items.length}</span></div>
      <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
        {items.length === 0
          ? <div className="text-slate-600 text-sm py-4">{empty}</div>
          : items.map((r) => {
              const cc = chgColor(r.mom_chg, goodUp);
              const isActive = active && r.industry_code === active;
              return (
                <button key={r.industry_code} onClick={() => onPick(r.industry_code)}
                  className={`group w-full text-left cursor-pointer ${isActive ? "bg-[#1f6feb1a] -mx-2 px-2 rounded-lg" : ""}`}>
                  <div className="flex items-center justify-between text-sm">
                    <span className={`truncate pr-2 ${isActive ? "text-white" : "text-slate-300 group-hover:text-white"}`}>{r.industry_text}</span>
                    <span className="flex items-center gap-3 tabular-nums shrink-0">
                      <span className="text-slate-500 text-xs">{r.value.toFixed(1)}</span>
                      <span className="text-xs w-16 text-right font-medium" style={{ color: cc }}>{arrow(r.mom_chg)} {signed(r.mom_chg)}</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-[#0d1117] rounded mt-1 overflow-hidden">
                    <div style={{ width: `${(Math.abs(r.mom_chg) / maxMag) * 100}%`, background: cc }} className="h-full rounded" />
                  </div>
                </button>
              );
            })}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
      <Col title="Picking up ▲" items={up} empty="Nothing rose this month." />
      <Col title="Slowing down ▼" items={down} empty="Nothing fell this month." />
    </div>
  );
}
