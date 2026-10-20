import { useEffect, useMemo, useState } from "react";
import { getNode, getTrend, getMomentum, getHistory, getCategories, getMonths } from "./api";
import LineChart from "./LineChart";

const UP = "#3fb950", DOWN = "#f85149", AMBER = "#f0883e";

const CLASSES = {
  fd: { label: "Final Demand", root: "FD4", treeLabel: "Producer price pipeline",
        note: "Flow-based · SA for MoM, NSA for YoY", tail: "Intermediate Demand (upstream input costs) lands here next." },
  commodity: { label: "Commodities", root: "00000000", treeLabel: "Commodity groups",
               note: "By product type · NSA · history to 1913", tail: "Deep history — see energy, metals & chemicals through past crises." },
};

// Producer-side framing for the top branches (fallbacks to the BLS name).
const BLURB = {
  FD4: "Prices producers receive for goods & services sold to final buyers — the PPI headline.",
  FD41: "Goods leaving the producer for final demand — energy, food, and core goods.",
  FD42: "Services producers charge at final demand — trade margins, freight, and the rest.",
  FD43: "Producer prices for new construction put in place.",
  FD411: "Producer prices for foods sold into final demand.",
  FD412: "Producer energy prices — the most volatile input in the pipeline.",
  FD413: "Core final-demand goods, stripping out food & energy noise.",
  "00000000": "All commodities — the broadest producer index, back to 1913.",
  "05": "Producer energy — fuels & power, through every oil shock since the 1920s.",
  "06": "Producer chemical prices — a key industrial input cost.",
  "10": "Producer metals prices — steel, copper, aluminium and the rest.",
  "11": "Producer prices for machinery & equipment.",
};

export default function PPIExplorer() {
  const [cls, setCls] = useState("fd");
  const [cats, setCats] = useState([]);
  const [months, setMonths] = useState([]);
  const [sel, setSel] = useState(CLASSES.fd.root);
  const [expanded, setExpanded] = useState(() => new Set([CLASSES.fd.root]));
  const [lookback, setLookback] = useState(1);
  const [metric, setMetric] = useState("yoy_pct");
  const [mfreq, setMfreq] = useState("q");   // momentum granularity: monthly | quarterly | semi-annual
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [node, setNode] = useState(null);
  const [trend, setTrend] = useState([]);
  const [momentum, setMomentum] = useState(null);
  const [history, setHistory] = useState([]);

  const commodity = cls === "commodity";

  // load tree + month spine when classification changes; reset to its root
  useEffect(() => {
    const c = CLASSES[cls];
    setSel(c.root);
    setExpanded(new Set([c.root]));
    Promise.all([getCategories("ppi", cls), getMonths("ppi", cls)]).then(([cc, m]) => {
      setCats(cc); setMonths(m);
      if (m.length) { setTo(m[m.length - 1].value); setFrom(m[Math.max(0, m.length - 37)].value); }
    });
  }, [cls]);

  // node card + sub-breakdown follow selection + window
  useEffect(() => { if (sel) getNode(sel, lookback, "ppi", cls).then(setNode); }, [sel, lookback, cls]);
  // momentum + history follow selection
  useEffect(() => {
    if (!sel) return;
    getMomentum(sel, 24, "ppi", cls).then(setMomentum);
    getHistory(sel, 24, "ppi", cls).then(setHistory);
  }, [sel, cls]);
  // trend follows selection + range
  useEffect(() => { if (sel && from && to) getTrend(sel, from, to, "ppi", cls).then(setTrend); }, [sel, from, to, cls]);

  const byCode = useMemo(() => Object.fromEntries(cats.map((c) => [c.item_code, c])), [cats]);
  const code = (ic) => ic.slice(2);
  const childrenOf = (ic) => {
    if (commodity) return cats.filter((c) => c.parent === ic);
    const p = code(ic);
    return cats
      .filter((c) => { const cc = code(c.item_code); return cc.length === p.length + 1 && cc.startsWith(p); })
      .sort((a, b) => a.item_code.localeCompare(b.item_code));
  };
  // breadcrumb: walk up to the root
  const path = useMemo(() => {
    if (commodity) {
      const out = []; let cur = byCode[sel]; let guard = 0;
      while (cur && guard++ < 20) { out.unshift(cur); cur = cur.parent ? byCode[cur.parent] : null; }
      return out;
    }
    const p = code(sel), out = [];
    for (let k = 1; k <= p.length; k++) {
      const ic = "FD" + p.slice(0, k);
      if (byCode[ic]) out.push(byCode[ic]);
    }
    return out;
  }, [sel, byCode, commodity]);

  const toggle = (ic) => setExpanded((s) => {
    const n = new Set(s); n.has(ic) ? n.delete(ic) : n.add(ic); return n;
  });

  // quick range presets (n months back; 0 = full history)
  const setRange = (n) => {
    if (!months.length) return;
    setTo(months[months.length - 1].value);
    setFrom(n === 0 ? months[0].value : months[Math.max(0, months.length - 1 - n)].value);
  };

  const accel = node && node.prev_mom_pct != null ? node.mom_pct - node.prev_mom_pct : null;
  const maxChild = Math.max(0.1, ...((node?.children || []).map((r) => Math.abs(r.mom_pct || 0))));
  const dir = momentum?.summary?.direction;
  const dirColor = dir === "accelerating" ? AMBER : dir === "decelerating" ? UP : "#7d8590";
  const label = (v) => months.find((m) => m.value === v)?.label || v;

  return (
    <div className="grid lg:grid-cols-[300px_1fr] gap-4">
      {/* LEFT — structure navigator */}
      <div className="h-fit lg:sticky lg:top-4 space-y-3">
        {/* classification switch */}
        <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733]">
          {Object.entries(CLASSES).map(([k, v]) => (
            <button key={k} onClick={() => setCls(k)}
              className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium ${cls === k ? "bg-[#1f6feb] text-white" : "text-slate-400 hover:text-slate-200"}`}>{v.label}</button>
          ))}
        </div>
        <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-3">
          <div className="text-xs uppercase tracking-wide text-slate-500 px-2 pt-1 pb-2">{CLASSES[cls].treeLabel}</div>
          {byCode[CLASSES[cls].root] &&
            <TreeNode ic={CLASSES[cls].root} label={byCode[CLASSES[cls].root].item_name}
              {...{ sel, setSel, expanded, toggle, childrenOf, depth: 0 }} />}
          <div className="mt-3 pt-3 border-t border-[#1e2733] px-2 text-[11px] text-slate-600 leading-relaxed">
            {CLASSES[cls].tail}
          </div>
        </div>
      </div>

      {/* RIGHT — category detail */}
      <div className="space-y-4">
        {/* breadcrumb */}
        <div className="flex items-center gap-1.5 text-sm flex-wrap">
          {path.map((n, i) => (
            <span key={n.item_code} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-slate-600">›</span>}
              <button onClick={() => setSel(n.item_code)}
                className={i === path.length - 1 ? "text-white font-medium" : "text-slate-400 hover:text-slate-200"}>
                {n.item_name}
              </button>
            </span>
          ))}
        </div>

        {/* hero print */}
        {node && (
          <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="max-w-xl">
                <div className="text-xl font-semibold">{node.item_name}</div>
                <div className="text-sm text-slate-500 mt-1">{BLURB[node.item_code] || "Producer prices for this category."}</div>
              </div>
              {dir && <span className="px-3 py-1.5 rounded-lg text-sm font-medium shrink-0"
                style={{ background: dirColor + "22", color: dirColor }}>
                {dir === "accelerating" ? "▲ Accelerating" : dir === "decelerating" ? "▼ Decelerating" : "● Steady"}
              </span>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
              <Big label={`MoM (${commodity ? "NSA" : "SA"}) · ${node.month}`} v={node.mom_pct} sub={accel != null ? `${accel > 0 ? "+" : ""}${accel.toFixed(2)}pp vs prior` : null} subUp={accel > 0} />
              <Big label="YoY (NSA)" v={node.yoy_pct} sub={node.prev_yoy_pct != null ? `from ${node.prev_yoy_pct.toFixed(2)}%` : null} subUp={node.yoy_pct - node.prev_yoy_pct > 0} />
              <Big label="3-mo annualized" v={momentum?.summary?.ann3_pct} plain />
              <div>
                <div className="text-xs text-slate-500">Index</div>
                <div className="text-2xl font-semibold tabular-nums text-slate-200">{node.index?.toFixed(1)}</div>
              </div>
            </div>
          </div>
        )}

        {/* sub-breakdown — what's driving THIS category */}
        {node && node.children.length > 0 && (
          <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-5">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <div className="text-lg font-medium">What's moving inside <span className="text-slate-400">{node.item_name}</span></div>
              <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733]">
                {[[1, "1M"], [3, "3M"], [6, "6M"], [12, "12M"]].map(([lb, l]) => (
                  <button key={lb} onClick={() => setLookback(lb)}
                    className={`px-2.5 py-1 rounded-md text-xs ${lookback === lb ? "bg-[#1f6feb] text-white" : "text-slate-400 hover:text-slate-200"}`}>{l}</button>
                ))}
              </div>
            </div>
            <div className="text-xs text-slate-500 mb-4">{node.from_label} → {node.to_label} · click to drill in</div>
            <div className="space-y-2">
              {node.children.map((r) => {
                const col = r.mom_pct >= 0 ? UP : DOWN;
                const drillable = !!byCode[r.item_code] && childrenOf(r.item_code).length >= 0;
                return (
                  <button key={r.item_code} onClick={() => byCode[r.item_code] && setSel(r.item_code)}
                    className="w-full text-left group">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-300 group-hover:text-white truncate pr-2">{r.item_name}</span>
                      <span style={{ color: col }} className="font-semibold tabular-nums">{r.mom_pct > 0 ? "+" : ""}{r.mom_pct?.toFixed(2)}%</span>
                    </div>
                    <div className="h-1.5 bg-[#0d1117] rounded mt-1 overflow-hidden">
                      <div style={{ width: `${(Math.abs(r.mom_pct) / maxChild) * 100}%`, background: col }} className="h-full rounded" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* trend over time */}
        <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
            <div className="text-lg font-medium">Trend over time</div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <RangeSelect value={from} onChange={setFrom} options={months} />
                <span className="text-slate-600 text-sm">→</span>
                <RangeSelect value={to} onChange={setTo} options={months} />
              </div>
              <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733]">
                {[[12, "1Y"], [36, "3Y"], [60, "5Y"], [0, "Max"]].map(([n, l]) => (
                  <button key={l} onClick={() => setRange(n)}
                    className="px-2.5 py-1 rounded-md text-xs text-slate-400 hover:text-slate-200">{l}</button>
                ))}
              </div>
              <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733]">
                {[["yoy_pct", "YoY %"], ["mom_pct", "MoM %"], ["value", "Index"]].map(([m, l]) => (
                  <button key={m} onClick={() => setMetric(m)}
                    className={`px-3 py-1 rounded-md text-xs ${metric === m ? "bg-[#1f6feb] text-white" : "text-slate-400 hover:text-slate-200"}`}>{l}</button>
                ))}
              </div>
            </div>
          </div>
          <LineChart data={trend} metric={metric} color={metric === "value" ? "#58a6ff" : "#a371f7"} domain={{ from, to }} />
          {trend.length > 0 && trend[0].period > from &&
            <div className="text-xs text-slate-500 mt-2">Series data begins {trend[0].label} — no earlier history exists for this category.</div>}
        </div>

        {/* momentum bars — monthly or quarterly */}
        {momentum && (
          <div className="bg-[#121821] border border-[#1e2733] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="text-sm text-slate-400">
                {mfreq === "q" ? "Quarter-over-quarter" : mfreq === "h" ? "Half-over-half" : "Monthly"} change
                ({commodity ? "NSA" : "SA"}), last 24 ·{" "}
                {mfreq === "q" ? "QoQ" : mfreq === "h" ? "HoH" : "MoM"} accel {fmt(momentum.summary.accel_mom, "pp")}
              </div>
              <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-[#1e2733]">
                {[["m", "Monthly"], ["q", "Quarterly"], ["h", "Semi-annual"]].map(([k, l]) => (
                  <button key={k} onClick={() => setMfreq(k)}
                    className={`px-2.5 py-1 rounded-md text-xs ${mfreq === k ? "bg-[#1f6feb] text-white" : "text-slate-400 hover:text-slate-200"}`}>{l}</button>
                ))}
              </div>
            </div>
            {mfreq === "q"
              ? <MomentumBars data={(momentum.quarters || []).slice(-24).map((q) => ({ ym: q.label, label: q.label, mom_pct: q.chg_pct }))} periodic />
              : mfreq === "h"
              ? <MomentumBars data={(momentum.halves || []).slice(-24).map((h) => ({ ym: h.label, label: h.label, mom_pct: h.chg_pct }))} periodic />
              : <MomentumBars data={momentum.series.slice(-24)} />}
          </div>
        )}
      </div>
    </div>
  );
}

function TreeNode({ ic, label, sel, setSel, expanded, toggle, childrenOf, depth }) {
  const kids = childrenOf(ic);
  const hasKids = kids.length > 0;
  const open = expanded.has(ic);
  const active = sel === ic;
  return (
    <div>
      <div className={`flex items-center rounded-md ${active ? "bg-[#1f6feb22]" : "hover:bg-[#0d1117]"}`}
        style={{ paddingLeft: depth * 12 }}>
        <button onClick={() => hasKids && toggle(ic)} className="w-5 shrink-0 text-slate-500 text-xs">
          {hasKids ? (open ? "▾" : "▸") : ""}
        </button>
        <button onClick={() => setSel(ic)}
          className={`flex-1 text-left py-1.5 pr-2 text-sm truncate ${active ? "text-white font-medium" : "text-slate-300 hover:text-white"}`}>
          {label}
        </button>
      </div>
      {open && kids.map((k) => (
        <TreeNode key={k.item_code} ic={k.item_code} label={k.item_name}
          {...{ sel, setSel, expanded, toggle, childrenOf, depth: depth + 1 }} />
      ))}
    </div>
  );
}

function Big({ label, v, sub, subUp, plain }) {
  const col = plain ? "#e6edf3" : v > 0 ? AMBER : v < 0 ? UP : "#e6edf3";
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-semibold tabular-nums" style={{ color: col }}>
        {v == null ? "—" : (v > 0 && !plain ? "+" : "") + v.toFixed(2) + "%"}
      </div>
      {sub && <div className="text-xs tabular-nums" style={{ color: subUp ? AMBER : UP }}>{sub}</div>}
    </div>
  );
}

const fmt = (v, s = "") => (v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(2) + s);

function RangeSelect({ value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="bg-[#0d1117] border border-[#30363d] rounded-md px-2.5 py-1.5 text-xs">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function MomentumBars({ data, periodic }) {
  const W = 1200, H = 190, pad = 24, gap = data.length > 14 ? 4 : 6;
  const vals = data.map((d) => d.mom_pct ?? 0);
  const max = Math.max(0.1, ...vals.map(Math.abs));
  const bw = (W - pad * 2) / Math.max(1, data.length) - gap;
  const zero = H / 2 + 8;
  const dense = data.length > 14 && !periodic;   // periods: label every bar
  return (
    <svg viewBox={`0 0 ${W} ${H + 8}`} className="w-full">
      <line x1={pad} x2={W - pad} y1={zero} y2={zero} stroke="#30363d" />
      {data.map((d, i) => {
        const v = d.mom_pct ?? 0;
        const h = (Math.abs(v) / max) * (H / 2 - 24);
        const x = pad + i * (bw + gap);
        const y = v >= 0 ? zero - h : zero;
        const showLbl = !dense || i % 2 === 0;
        const [t1, t2] = d.label.split(" ");
        return (
          <g key={d.ym}>
            <rect x={x} y={y} width={bw} height={h} rx="2" fill={v >= 0 ? UP : DOWN} />
            {d.mom_pct != null && <text x={x + bw / 2} y={v >= 0 ? y - 4 : y + h + 11} textAnchor="middle" fontSize="9.5" fill="#7d8590">{v >= 0 ? "+" : ""}{v.toFixed(2)}</text>}
            {showLbl && <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="9" fill="#586069">{t1}</text>}
            {showLbl && <text x={x + bw / 2} y={H + 4} textAnchor="middle" fontSize="7.5" fill="#3d444d">{t2?.length > 2 ? t2.slice(2) : t2}</text>}
          </g>
        );
      })}
    </svg>
  );
}
