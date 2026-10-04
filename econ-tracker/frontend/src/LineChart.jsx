import { useState } from "react";

// Hand-rolled responsive SVG line chart with hover crosshair.
// data: [{ period, label, value, mom_pct, yoy_pct }]  (period = "YYYY-MM")
// domain (optional): { from, to } as "YYYY-MM" — x-axis spans this range so the
// chart honours the selected window (a series that starts late starts late).
const ordOf = (ym) => { const [y, m] = ym.split("-").map(Number); return y * 12 + m; };
const labelOf = (ord) => {
  const y = Math.floor((ord - 1) / 12), m = ((ord - 1) % 12) + 1;
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${M[m - 1]} ${y}`;
};

export default function LineChart({ data, metric = "value", color = "#58a6ff", domain = null }) {
  const [hover, setHover] = useState(null);
  const W = 900, H = 340, padL = 56, padR = 20, padT = 20, padB = 40;

  const pts = data.filter((d) => d[metric] != null && d.period);
  if (pts.length < 2) return <div className="text-slate-500 p-8">Not enough data for this range.</div>;

  const ords = pts.map((d) => ordOf(d.period));
  // x-domain: selected window if given, else the data's own span
  const x0 = domain?.from ? Math.min(ordOf(domain.from), ords[0]) : ords[0];
  const x1 = domain?.to ? Math.max(ordOf(domain.to), ords[ords.length - 1]) : ords[ords.length - 1];
  const span = Math.max(1, x1 - x0);

  const ys = pts.map((d) => d[metric]);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const yPad = (yMax - yMin) * 0.08 || 1;
  const lo = yMin - yPad, hi = yMax + yPad;

  const X = (ord) => padL + ((ord - x0) / span) * (W - padL - padR);
  const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  const path = pts.map((d, i) => `${i === 0 ? "M" : "L"} ${X(ords[i])} ${Y(d[metric])}`).join(" ");
  const area = `${path} L ${X(ords[pts.length - 1])} ${H - padB} L ${X(ords[0])} ${H - padB} Z`;

  const ticks = 5;
  const grid = Array.from({ length: ticks + 1 }, (_, k) => lo + (k / ticks) * (hi - lo));
  // x labels: ~8 evenly spaced across the time domain (year granularity)
  const nLab = 8;
  const xlabs = Array.from({ length: nLab + 1 }, (_, k) => Math.round(x0 + (k / nLab) * span));

  const fmt = (v) => (metric === "value" ? v.toFixed(1) : v.toFixed(2) + "%");

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    // nearest point by x position
    let best = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) { const d = Math.abs(X(ords[i]) - mx); if (d < bd) { bd = d; best = i; } }
    setHover(best);
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <defs>
        <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid.map((g, k) => (
        <g key={k}>
          <line x1={padL} x2={W - padR} y1={Y(g)} y2={Y(g)} stroke="#1e2733" strokeWidth="1" />
          <text x={padL - 8} y={Y(g) + 4} textAnchor="end" fontSize="11" fill="#7d8590">{fmt(g)}</text>
        </g>
      ))}
      {xlabs.map((ord, k) => (
        <text key={k} x={X(ord)} y={H - padB + 18} textAnchor="middle" fontSize="10" fill="#7d8590">{labelOf(ord)}</text>
      ))}
      <path d={area} fill="url(#fill)" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" />
      {hover != null && (
        <g>
          <line x1={X(ords[hover])} x2={X(ords[hover])} y1={padT} y2={H - padB} stroke="#3b4654" strokeDasharray="3 3" />
          <circle cx={X(ords[hover])} cy={Y(pts[hover][metric])} r="4" fill={color} />
          <g transform={`translate(${Math.min(X(ords[hover]) + 10, W - 150)}, ${padT + 6})`}>
            <rect width="140" height="46" rx="6" fill="#0d1117" stroke="#30363d" />
            <text x="10" y="18" fontSize="11" fill="#e6edf3">{pts[hover].label}</text>
            <text x="10" y="36" fontSize="12" fill={color} fontWeight="600">{fmt(pts[hover][metric])}</text>
          </g>
        </g>
      )}
    </svg>
  );
}
