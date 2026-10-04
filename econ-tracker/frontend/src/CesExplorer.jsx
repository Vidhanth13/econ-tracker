import { useEffect, useMemo, useState } from "react";

// CES — BLS Current Employment Statistics, the Nonfarm Payrolls report. The
// headline is the MONTHLY CHANGE in total nonfarm jobs (the "+85K" print);
// earnings/hours ride alongside. Pure DB -> API -> app, no LLM.
const j = (url) => fetch(url).then((r) => r.json());

const UP = "#3fb950", DOWN = "#f85149", BLUE = "#58a6ff", HOT = "#f0883e", PURPLE = "#a371f7", NEU = "#7d8590";
const ordOf = (ym) => { const [y, m] = ym.split("-").map(Number); return y * 12 + m; };

// jobs change is in thousands: 85 -> "+85K", 1240 -> "+1.24M"
const fmtJobs = (v) => v == null ? "—"
  : (v > 0 ? "+" : v < 0 ? "−" : "") + (Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(2) + "M" : Math.abs(v).toFixed(0) + "K");
const fmtLevel = (v) => v == null ? "—" : (v / 1000).toFixed(1) + "M";   // thousands -> millions of jobs
const signed = (v, d = 2, s = "%") => v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(d) + s;
const jobsColor = (v) => v == null ? NEU : v >= 0 ? UP : DOWN;
const wageColor = (v) => v == null ? NEU : v > 3.5 ? HOT : v >= 3 ? BLUE : UP;

export default function CesExplorer() {
  const [ov, setOv] = useState(null);
  const [months, setMonths] = useState([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => { j("/api/ces/overview").then(setOv); }, []);
  useEffect(() => {
    j("/api/ces/months").then((m) => {
      setMonths(m);
      if (m.length) { setTo(m[m.length - 1].value); setFrom(m[Math.max(0, m.length - 121)].value); }
    });
  }, []);

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div>
        <div className="text-sm text-slate-400 mb-2">
          US nonfarm payrolls · monthly, seasonally adjusted · the jobs report
          {ov?.month && <span className="text-slate-500"> · {ov.month}</span>}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(ov?.cards || []).map((c) => <HeroCard key={c.key} c={c} />)}
        </div>
      </div>

      <PayrollsChart from={from} to={to} months={months} setFrom={setFrom} setTo={setTo} />
      <WageHoursChart from={from} to={to} months={months} setFrom={setFrom} setTo={setTo} />
      <SectorSection months={months} />

      <div className="text-center text-slate-600 text-xs mt-2">econ_data · BLS CES (survey ce) · monthly SA · no LLM, pure DB → API → app</div>
    </div>
  );
}

// ---- Chart card 1: payrolls — Nonfarm + Private overlaid --------------------
function PayrollsChart({ from, to, months, setFrom, setTo }) {
  const [nfp, setNfp] = useState(null);
  const [priv, setPriv] = useState(null);
  const [mode, setMode] = useState("chg");   // chg = jobs added | level = total jobs
  const [view, setView] = useState("both");  // both | nfp | priv
  useEffect(() => {
    if (!from || !to) return;
    j(`/api/ces/trend?key=nfp&from=${from}&to=${to}`).then(setNfp);
    j(`/api/ces/trend?key=private&from=${from}&to=${to}`).then(setPriv);
  }, [from, to]);

  const reduce = (pts) => (pts || []).map((p) => ({ ym: p.ym, label: p.label, v: mode === "chg" ? p.mom_chg : p.value }));
  const all = [
    { key: "nfp", label: "Nonfarm", color: BLUE, pts: reduce(nfp?.points) },
    { key: "priv", label: "Private", color: UP, pts: reduce(priv?.points) },
  ];
  const series = view === "both" ? all : all.filter((s) => s.key === view);
  return (
    <Card title="Payrolls" subtitle={mode === "chg" ? "jobs added each month (000s) — the NFP print" : "total jobs on payrolls"}
      from={from} to={to} months={months} setFrom={setFrom} setTo={setTo}
      toggle={<>
        <Toggle opts={[["both", "Both"], ["nfp", "Nonfarm"], ["priv", "Private"]]} val={view} set={setView} accent />
        <Toggle opts={[["chg", "Jobs added"], ["level", "Total level"]]} val={mode} set={setMode} />
      </>}>
      {view === "both" && <Legend series={series} />}
      <Plot series={series} fmtY={mode === "chg" ? fmtJobs : fmtLevel} zeroLine={mode === "chg"} asBars={view !== "both" && mode === "chg"} />
    </Card>
  );
}

// ---- Chart card 2: wages & hours -------------------------------------------
function WageHoursChart({ from, to, months, setFrom, setTo }) {
  const [sub, setSub] = useState("earnings");   // earnings | hours
  const [mode, setMode] = useState("yoy");      // yoy | level
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!from || !to) return;
    j(`/api/ces/trend?key=${sub}&from=${from}&to=${to}`).then(setData);
  }, [sub, from, to]);

  const isEarn = sub === "earnings";
  const pts = (data?.points || []).map((p) => ({ ym: p.ym, label: p.label, v: mode === "yoy" ? p.yoy_pct : p.value }));
  const fmtY = mode === "yoy" ? (v) => v.toFixed(1) + "%"
    : isEarn ? (v) => "$" + v.toFixed(2) : (v) => v.toFixed(1) + "h";
  const series = [{ label: isEarn ? "Avg hourly earnings" : "Avg weekly hours", color: isEarn ? HOT : PURPLE, pts }];
  return (
    <Card title="Wages & hours"
      subtitle={isEarn ? (mode === "yoy" ? "wage growth YoY — the Fed's wage-inflation signal" : "average hourly earnings ($)")
                       : (mode === "yoy" ? "hours worked YoY" : "average weekly hours")}
      from={from} to={to} months={months} setFrom={setFrom} setTo={setTo}
      toggle={<>
        <Toggle opts={[["earnings", "Earnings"], ["hours", "Hours"]]} val={sub} set={setSub} accent />
        <Toggle opts={[["yoy", "YoY %"], ["level", "Level"]]} val={mode} set={setMode} />
      </>}>
      <Plot series={series} fmtY={fmtY} zeroLine={mode === "yoy"} asBars={false} />
    </Card>
  );
}

// ---- Sector breakdown + click-to-chart -------------------------------------
function SectorSection({ months }) {
  const [sectors, setSectors] = useState(null);
  const [sortBy, setSortBy] = useState("change");   // change | level
  const [sel, setSel] = useState({ code: "70000000", name: "Leisure and hospitality" });
  const [trend, setTrend] = useState(null);
  const [mode, setMode] = useState("chg");          // chg | level
  const [from, setFrom] = useState("");             // this chart's own date range
  const [to, setTo] = useState("");

  useEffect(() => { j("/api/ces/industry").then(setSectors); }, []);
  useEffect(() => {
    if (months.length && !to) { setTo(months[months.length - 1].value); setFrom(months[Math.max(0, months.length - 121)].value); }
  }, [months]);
  useEffect(() => {
    if (!from || !to || !sel) return;
    j(`/api/ces/trend?key=nfp&industry=${sel.code}&from=${from}&to=${to}`).then(setTrend);
  }, [sel, from, to]);

  // clean 11-sector NFP breakdown: real sectors only (drop aggregate roll-ups)
  const rows = (sectors?.rows || []).filter((x) => x.display_level === 2);
  const sorted = useMemo(() => {
    if (sortBy === "level") return [...rows].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return [...rows].sort((a, b) => (b.mom_chg ?? -1e9) - (a.mom_chg ?? -1e9));
  }, [rows, sortBy]);
  const maxJobs = Math.max(1, ...rows.map((x) => Math.abs(x.mom_chg || 0)));

  const pts = (trend?.points || []).map((p) => ({ ym: p.ym, label: p.label, v: mode === "chg" ? p.mom_chg : p.value }));

  return (
    <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-5">
      <div className="flex items-center gap-3 mb-1">
        <div className="text-lg font-medium">Where the jobs came from</div>
        <span className="text-xs text-slate-500">· {sectors?.month || "…"} · by sector</span>
      </div>

      {/* selected-sector chart — with its own date range (cf. CPI chart) */}
      <div className="mt-3 mb-4 bg-[#0d1117] border border-[#1e2733] rounded-lg p-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="text-sm font-medium" style={{ color: BLUE }}>{sel?.name} <span className="text-slate-500 font-normal">· over time</span></div>
            <MonthSelect value={from} onChange={setFrom} options={months} />
            <span className="text-slate-600 text-sm">→</span>
            <MonthSelect value={to} onChange={setTo} options={months} />
          </div>
          <Toggle opts={[["chg", "Jobs added"], ["level", "Total level"]]} val={mode} set={setMode} />
        </div>
        <Plot series={[{ label: sel?.name, color: BLUE, pts }]}
          fmtY={mode === "chg" ? fmtJobs : fmtLevel} zeroLine={mode === "chg"} asBars={mode === "chg"} H={240} />
      </div>

      {/* list controls: sort toggle sits with the categories */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="text-xs text-slate-500">
          <span style={{ color: UP }}>green</span> = jobs added · <span style={{ color: DOWN }}>red</span> = jobs lost this month ·
          bar = size of the monthly change · <span className="text-slate-300">click a sector to chart it ↑</span>
        </div>
        <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733]">
          {[["change", "Jobs added"], ["level", "Total size"]].map(([k, lbl]) => (
            <button key={k} onClick={() => setSortBy(k)}
              className={`px-2.5 py-1 rounded-md text-xs ${sortBy === k ? "bg-[#30363d] text-white" : "text-slate-400 hover:text-slate-200"}`}>{lbl}</button>
          ))}
        </div>
      </div>
      {sectors === null
        ? <div className="text-slate-500 p-6 text-sm">Loading…</div>
        : <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
            {sorted.map((r) => (
              <button key={r.industry_code} onClick={() => setSel({ code: r.industry_code, name: r.industry_name })}
                className={`group w-full text-left ${sel?.code === r.industry_code ? "bg-[#1f6feb1a] -mx-2 px-2 rounded-lg" : ""}`}>
                <div className="flex items-center justify-between text-sm gap-3">
                  <span className={`truncate ${sel?.code === r.industry_code ? "text-white" : "text-slate-300 group-hover:text-white"}`}>{r.industry_name}</span>
                  <span className="flex items-center gap-4 tabular-nums shrink-0 text-xs">
                    <span className="text-slate-400 w-16 text-right">{fmtLevel(r.value)}</span>
                    <span className="w-16 text-right font-semibold" style={{ color: jobsColor(r.mom_chg) }}>{fmtJobs(r.mom_chg)}</span>
                    <span className="w-16 text-right" style={{ color: jobsColor(r.yoy_pct) }}>{signed(r.yoy_pct)} yr</span>
                  </span>
                </div>
                <div className="h-1.5 bg-[#0d1117] rounded mt-1 overflow-hidden">
                  <div style={{ width: `${(Math.abs(r.mom_chg || 0) / maxJobs) * 100}%`, background: jobsColor(r.mom_chg) }} className="h-full rounded" />
                </div>
              </button>
            ))}
          </div>}
    </div>
  );
}

// ---- Shared pieces ---------------------------------------------------------
const mlabel = (months, v) => months.find((m) => m.value === v)?.label || v;

function Card({ title, subtitle, from, to, months, setFrom, setTo, toggle, children }) {
  return (
    <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <div>
          <div className="text-lg font-medium">{title}</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {subtitle}{from && to && <span className="text-slate-600"> · {mlabel(months, from)} → {mlabel(months, to)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {toggle}
          <div className="flex items-center gap-1.5">
            <MonthSelect value={from} onChange={setFrom} options={months} />
            <span className="text-slate-600 text-sm">→</span>
            <MonthSelect value={to} onChange={setTo} options={months} />
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

function Toggle({ opts, val, set, accent }) {
  return (
    <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733]">
      {opts.map(([k, lbl]) => (
        <button key={k} onClick={() => set(k)}
          className={`px-2.5 py-1 rounded-md text-xs ${val === k ? (accent ? "bg-[#1f6feb] text-white" : "bg-[#30363d] text-white") : "text-slate-400 hover:text-slate-200"}`}>{lbl}</button>
      ))}
    </div>
  );
}

function Legend({ series }) {
  return (
    <div className="flex items-center gap-4 mb-1 text-xs">
      {series.map((s) => (
        <span key={s.label} className="flex items-center gap-1.5 text-slate-400">
          <span className="w-3 h-0.5 rounded" style={{ background: s.color }} />{s.label}
        </span>
      ))}
    </div>
  );
}

function MonthSelect({ value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="bg-[#0d1117] border border-[#30363d] rounded-md px-2.5 py-1.5 text-sm">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// Generic plot: series = [{label,color,pts:[{ym,label,v}]}]. Lines for every
// series; single-series can render as signed bars (asBars). Hover shows all.
function Plot({ series, fmtY, zeroLine = false, asBars = false, H = 320 }) {
  const [hover, setHover] = useState(null);
  const W = 900, padL = 52, padR = 16, padT = 16, padB = 34;
  const allPts = series.flatMap((s) => s.pts.filter((p) => p.v != null));
  if (allPts.length < 2) return <div className="text-slate-500 p-8">No data for this range.</div>;

  const ords = allPts.map((p) => ordOf(p.ym));
  const x0 = Math.min(...ords), x1 = Math.max(...ords);
  const vs = allPts.map((p) => p.v);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const yPad = (hi - lo) * 0.08 || 1;
  const yl = Math.min(lo - yPad, zeroLine ? 0 : lo - yPad), yh = Math.max(hi + yPad, zeroLine ? 0 : hi + yPad);
  const span = Math.max(1, x1 - x0);
  const X = (o) => padL + ((o - x0) / span) * (W - padL - padR);
  const Y = (v) => padT + (1 - (v - yl) / (yh - yl)) * (H - padT - padB);

  const ticks = 5;
  const grid = Array.from({ length: ticks + 1 }, (_, k) => yl + (k / ticks) * (yh - yl));
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const labOf = (o) => `${M[((o - 1) % 12)]} '${String(Math.floor((o - 1) / 12)).slice(2)}`;
  const nLab = 7;
  const xlabs = Array.from({ length: nLab + 1 }, (_, k) => Math.round(x0 + (k / nLab) * span));

  const onlyBars = asBars && series.length === 1;
  const bars = onlyBars ? series[0].pts.filter((p) => p.v != null) : [];
  const bw = Math.max(1, ((W - padL - padR) / Math.max(1, bars.length)) * 0.7);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const o = Math.round(x0 + ((mx - padL) / (W - padL - padR)) * span);
    setHover(Math.max(x0, Math.min(x1, o)));
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      {grid.map((g, k) => (
        <g key={k}>
          <line x1={padL} x2={W - padR} y1={Y(g)} y2={Y(g)} stroke="#1e2733" />
          <text x={padL - 6} y={Y(g) + 4} textAnchor="end" fontSize="10" fill="#7d8590">{fmtY(g)}</text>
        </g>
      ))}
      {zeroLine && yl < 0 && yh > 0 && <line x1={padL} x2={W - padR} y1={Y(0)} y2={Y(0)} stroke="#3b4654" />}
      {xlabs.map((o, k) => (
        <text key={k} x={X(o)} y={H - padB + 16} textAnchor="middle" fontSize="10" fill="#7d8590">{labOf(o)}</text>
      ))}
      {onlyBars
        ? bars.map((p, i) => {
            const y0 = Y(0), y1 = Y(p.v);
            return <rect key={i} x={X(ordOf(p.ym)) - bw / 2} y={Math.min(y0, y1)} width={bw}
                         height={Math.abs(y1 - y0)} fill={p.v >= 0 ? UP : DOWN} opacity="0.85" />;
          })
        : series.map((s, si) => {
            const sp = s.pts.filter((p) => p.v != null);
            if (sp.length < 2) return null;
            const d = sp.map((p, i) => `${i === 0 ? "M" : "L"} ${X(ordOf(p.ym)).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(" ");
            return <path key={si} d={d} fill="none" stroke={s.color} strokeWidth="2" />;
          })}
      {hover != null && (() => {
        const items = series.map((s) => ({ s, p: s.pts.find((p) => ordOf(p.ym) === hover) })).filter((x) => x.p && x.p.v != null);
        if (!items.length) return null;
        const lab = items[0].p.label;
        const bh = 16 + items.length * 15;
        return (
          <g>
            <line x1={X(hover)} x2={X(hover)} y1={padT} y2={H - padB} stroke="#3b4654" strokeDasharray="3 3" />
            {!onlyBars && items.map((it, i) => <circle key={i} cx={X(hover)} cy={Y(it.p.v)} r="3.5" fill={it.s.color} />)}
            <g transform={`translate(${Math.min(X(hover) + 10, W - 150)}, ${padT + 4})`}>
              <rect width="142" height={bh} rx="6" fill="#0d1117" stroke="#30363d" />
              <text x="9" y="14" fontSize="10" fill="#e6edf3">{lab}</text>
              {items.map((it, i) => (
                <text key={i} x="9" y={29 + i * 15} fontSize="11" fill={it.s.color} fontWeight="600">
                  {series.length > 1 ? it.s.label + "  " : ""}{fmtY(it.p.v)}
                </text>
              ))}
            </g>
          </g>
        );
      })()}
    </svg>
  );
}

function HeroCard({ c }) {
  const level = c.unit === "level";
  const dollars = c.unit === "dollars";
  let big, sub, accent;
  if (level) {
    big = fmtJobs(c.mom_chg); accent = jobsColor(c.mom_chg);
    sub = <span className="text-slate-500">level {fmtLevel(c.value)} · {fmtJobs(c.yoy_chg)} YoY</span>;
  } else if (dollars) {
    big = signed(c.yoy_pct) + "%"; accent = wageColor(c.yoy_pct);
    sub = <span className="text-slate-500">${c.value?.toFixed(2)}/hr · {signed(c.mom_pct)} MoM</span>;
  } else {
    big = c.value?.toFixed(1) + "h"; accent = BLUE;
    sub = <span className="text-slate-500">{signed(c.yoy_chg, 1, "h")} YoY</span>;
  }
  return (
    <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-4">
      <div className="flex items-start justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-500">{c.label}</div>
        <span className="w-2 h-2 rounded-full mt-1" style={{ background: accent }} />
      </div>
      <div className="text-3xl font-semibold tabular-nums mt-1" style={{ color: level || dollars ? accent : "#e6edf3" }}>{big}</div>
      <div className="text-xs tabular-nums mt-1">{sub}</div>
      <div className="text-[11px] text-slate-500 mt-1 leading-tight">{c.blurb}</div>
    </div>
  );
}
