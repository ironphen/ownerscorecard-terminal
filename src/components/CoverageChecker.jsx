// "Can it pay its interest?" — the interest-coverage checker.
// Shows the arithmetic on the filing's own numbers and links to the source on
// EDGAR. The point isn't to hand over a verdict; it's to let the reader check.
//
// Embed standalone:           <CoverageChecker client:visible />
// Or focused on one company:  <CoverageChecker ticker="AAL" client:visible />
//
// Reads the build-time dataset directly (fine at seed scale). At universe
// scale, switch to fetch('/data/fundamentals.json') to keep the bundle slim.
import { useState } from "react";
import fundamentals from "../data/fundamentals.json";
import { coverage, coverageVerdict, fmtUSD, GRAHAM_REFERENCE, TONE_COLOR } from "../lib/fundamentals.mjs";

const companies = fundamentals.companies || [];
const byTicker = Object.fromEntries(companies.map((c) => [c.ticker, c]));

function Bar({ ratio }) {
  // 0..10x scale, clipped, with Graham's reference line.
  const W = 520, H = 46, pad = 8;
  const max = 10;
  const x = (r) => pad + ((W - 2 * pad) * Math.min(Math.max(r, 0), max)) / max;
  const refX = x(GRAHAM_REFERENCE);
  const r = ratio == null ? null : Math.min(ratio, max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", marginTop: 10 }}
      role="img" aria-label={`Coverage ${ratio == null ? "n/a" : ratio.toFixed(1)} times`}>
      <line x1={pad} y1={H / 2} x2={W - pad} y2={H / 2} stroke="#ddd" strokeWidth="2" />
      {[0, 1, 2, 5, 10].map((t) => (
        <g key={t}>
          <line x1={x(t)} y1={H / 2 - 5} x2={x(t)} y2={H / 2 + 5} stroke="#bbb" />
          <text x={x(t)} y={H - 2} fontSize="10" fill="#888" textAnchor="middle">{t}x{t === 10 ? "+" : ""}</text>
        </g>
      ))}
      <line x1={refX} y1={6} x2={refX} y2={H / 2 + 8} stroke="#1a7a3c" strokeDasharray="3 2" />
      <text x={refX} y={5} fontSize="9" fill="#1a7a3c" textAnchor="middle">Graham 5x</text>
      {r != null ? <circle cx={x(r)} cy={H / 2} r="6" fill="#111" /> : null}
    </svg>
  );
}

function Result({ company }) {
  const result = coverage(company);
  const verdict = coverageVerdict(result);
  const color = TONE_COLOR[verdict.tone];
  const ratioText =
    result?.ratio != null ? `${result.ratio.toFixed(1)}×` : result?.noBurden ? "—" : "n/a";

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15 }}>
          <strong>{company.ticker}</strong> · {company.name}
          <span style={{ color: "#777" }}> — FY{company.fy} {company.form}</span>
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{ratioText}</div>
      </div>

      {result && !result.noBurden ? (
        <div style={{ fontSize: 14, color: "#333", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
          Operating income {fmtUSD(result.oi)} ÷ interest expense {fmtUSD(result.interest)} ={" "}
          <strong>{result.ratio.toFixed(1)}×</strong>
        </div>
      ) : null}

      <Bar ratio={result?.ratio ?? null} />

      <div style={{ color, fontWeight: 700, marginTop: 8 }}>{verdict.label}</div>
      <p style={{ fontSize: 14, color: "#333", margin: "4px 0 0" }}>{verdict.note}</p>

      <p style={{ fontSize: 13, color: "#555", margin: "10px 0 0" }}>
        Don't take our word for it —{" "}
        <a href={company.sourceUrl} target="_blank" rel="noopener" style={{ color: "#111" }}>
          read the filing on SEC EDGAR →
        </a>
      </p>
    </div>
  );
}

export default function CoverageChecker({ ticker = "" }) {
  const [sel, setSel] = useState(byTicker[ticker] ? ticker : "");
  const company = byTicker[sel];

  return (
    <div style={{ border: "1px solid #111", padding: "16px 18px", margin: "18px 0" }}>
      {fundamentals.sample ? (
        <div style={{ background: "#fff7e6", border: "1px solid #e0c98a", padding: "6px 10px", fontSize: 12, color: "#7a5b00", marginBottom: 12 }}>
          <strong>Sample data.</strong> Illustrative placeholders so the tool renders before the
          live pipeline has run. Run <code>npm run fetch:fundamentals</code> to replace with
          figures pulled straight from EDGAR. (The “read the filing” links are already real.)
        </div>
      ) : null}

      <label style={{ display: "block", fontSize: 14 }}>
        <span style={{ display: "block", marginBottom: 4, color: "#555" }}>
          Pick a company (or type a ticker):
        </span>
        <input
          list="coverage-universe"
          value={sel}
          onChange={(e) => setSel(e.target.value.toUpperCase().trim())}
          placeholder="e.g. AAL"
          style={{ padding: "8px 10px", border: "1px solid #111", fontFamily: "inherit", fontSize: 15, width: "min(220px, 70%)", textTransform: "uppercase" }}
        />
        <datalist id="coverage-universe">
          {companies.map((c) => (
            <option key={c.ticker} value={c.ticker}>{c.name}</option>
          ))}
        </datalist>
      </label>

      {company ? (
        <Result company={company} />
      ) : sel ? (
        <p style={{ fontSize: 14, color: "#8b1a1a", marginTop: 14 }}>
          {sel} isn't in the covered universe yet. Covered so far:{" "}
          {companies.map((c) => c.ticker).join(", ")}.
        </p>
      ) : (
        <p style={{ fontSize: 14, color: "#777", marginTop: 14 }}>
          Coverage tells you whether a year of operating profit can pay the interest bill.
          Below 1× is the zombie zone.
        </p>
      )}
    </div>
  );
}
