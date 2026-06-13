// Example interactive island for articles: drag the sliders, watch the curve.
// Embed in MDX with:
//   import CompoundingExplorer from "../../components/CompoundingExplorer.jsx";
//   <CompoundingExplorer client:visible />
import { useState } from "react";

const W = 640, H = 240, L = 8, R = 8, T = 10, B = 22;

const usd = (v) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function CompoundingExplorer() {
  const [monthly, setMonthly] = useState(300);
  const [rate, setRate] = useState(8);
  const [years, setYears] = useState(30);

  // Month-by-month balance with contributions at month end
  const r = rate / 100 / 12;
  const balances = [0];
  for (let m = 1; m <= years * 12; m++) {
    balances.push(balances[m - 1] * (1 + r) + monthly);
  }
  const contributed = monthly * years * 12;
  const final = balances[balances.length - 1];

  const innerW = W - L - R, innerH = H - T - B;
  const max = final || 1;
  const x = (i) => L + (innerW * i) / (balances.length - 1);
  const y = (v) => T + innerH * (1 - v / max);

  const sample = balances.filter((_, i) => i % 3 === 0 || i === balances.length - 1);
  const step = (balances.length - 1) / (sample.length - 1);
  const path = sample
    .map((v, i) => `${i ? "L" : "M"}${x(i * step).toFixed(1)},${y(v).toFixed(1)}`)
    .join("");
  const contribPath = sample
    .map((v, i) => `${i ? "L" : "M"}${x(i * step).toFixed(1)},${y(Math.min(monthly * i * step, max)).toFixed(1)}`)
    .join("");

  const slider = (label, value, set, min, max_, stepSize, fmt) => (
    <label style={{ display: "block", margin: "8px 0", fontSize: 14 }}>
      <span style={{ display: "inline-block", width: 200 }}>
        {label}: <strong>{fmt(value)}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max_}
        step={stepSize}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        style={{ width: "min(280px, 60%)", verticalAlign: "middle" }}
      />
    </label>
  );

  return (
    <div style={{ border: "1px solid #ddd", padding: "14px 16px", margin: "18px 0" }}>
      {slider("Invested per month", monthly, setMonthly, 25, 2000, 25, usd)}
      {slider("Annual return", rate, setRate, 1, 15, 0.5, (v) => `${v}%`)}
      {slider("Years", years, setYears, 5, 50, 1, (v) => `${v}`)}

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img"
        aria-label="Portfolio value versus amount contributed over time">
        <path d={contribPath} fill="none" stroke="#999" strokeWidth="1.2" strokeDasharray="4 3" />
        <path d={path} fill="none" stroke="#111" strokeWidth="1.8" />
        <text x={L} y={H - 6} fontSize="11" fill="#777">today</text>
        <text x={W - R} y={H - 6} fontSize="11" fill="#777" textAnchor="end">{years} years</text>
      </svg>

      <p style={{ fontSize: 14, margin: "8px 0 0" }}>
        You put in <strong>{usd(contributed)}</strong>; compounding turns it into{" "}
        <strong>{usd(final)}</strong>. The gap between the dashed line (contributions) and the
        solid line (value) is the part the market did for you — and almost all of it arrives
        in the later years.
      </p>
    </div>
  );
}
