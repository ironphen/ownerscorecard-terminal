// Shared, framework-agnostic compute for the fundamentals tools.
// Imported by both Astro pages (server) and React islands (client), so keep it
// pure ESM with no Node or browser built-ins.

// Compact USD formatting: 123000000000 -> "$123.0B", 450000000 -> "$450M".
export function fmtUSD(v) {
  if (v == null) return "—";
  const neg = v < 0;
  const a = Math.abs(v);
  let s;
  if (a >= 1e9) s = `$${(a / 1e9).toFixed(1)}B`;
  else if (a >= 1e6) s = `$${Math.round(a / 1e6)}M`;
  else if (a >= 1e3) s = `$${Math.round(a / 1e3)}K`;
  else s = `$${Math.round(a)}`;
  return neg ? `(${s})` : s;
}

// Interest coverage = operating income (EBIT) / interest expense.
// Returns null when it can't be computed honestly (missing EBIT, or no
// meaningful interest burden — which is a *good* sign, handled by the verdict).
export function coverage(company) {
  const oi = company?.lines?.operatingIncome;
  const interest = company?.lines?.interestExpense;
  if (oi == null) return null;
  if (interest == null) return { ratio: null, oi, interest: null, noBurden: true };
  if (interest <= 0) return { ratio: null, oi, interest, noBurden: true };
  return { ratio: oi / interest, oi, interest, noBurden: false };
}

// Verdict bands. Graham wanted a real margin of safety in coverage — several
// years of earnings covering interest many times over, not scraping by once. A
// common distillation of his bond-selection tests is ~5x for an industrial;
// treat it as a reference line, not a law, and read the original.
export const GRAHAM_REFERENCE = 5;

export function coverageVerdict(result) {
  if (!result) return { tone: "none", label: "Not enough data", note: "Operating income wasn't found in the filing data." };
  if (result.noBurden)
    return {
      tone: "good",
      label: "No meaningful interest burden",
      note: "Little or no interest expense reported — the business isn't leaning on lenders to operate.",
    };
  const r = result.ratio;
  if (r < 1)
    return {
      tone: "bad",
      label: "Does not cover its interest",
      note: "A full year of operating profit didn't cover the interest bill. This is the zombie zone: the business depends on refinancing, asset sales, or forbearance to service its debt.",
    };
  if (r < 2)
    return {
      tone: "warn",
      label: "Thin",
      note: "Operating profit covers interest, but with little room. A bad year, a refinancing at higher rates, or a revenue wobble closes the gap fast.",
    };
  if (r < GRAHAM_REFERENCE)
    return {
      tone: "ok",
      label: "Adequate",
      note: "Comfortable in a normal year, but below the margin of safety Graham looked for. Worth checking how stable the coverage has been across a full cycle.",
    };
  return {
    tone: "good",
    label: "Comfortable",
    note: "Operating profit covers interest with the kind of margin Graham wanted for a defensive holding. Necessary, not sufficient — it says solvent, not cheap.",
  };
}

export const TONE_COLOR = {
  good: "#1a7a3c",
  ok: "#555",
  warn: "#9a6a00",
  bad: "#8b1a1a",
  info: "#33597a",
  none: "#777",
};

const fmtX = (v, dp = 1) => (v == null ? "—" : `${v.toFixed(dp)}×`);

// --- additional checks, all from data the pipeline already pulls ---

// Earnings quality: does reported profit show up as cash?
export function earningsQuality(c) {
  const ni = c?.lines?.netIncome;
  const cfo = c?.lines?.cashFromOps;
  if (ni == null || cfo == null) return null;
  if (ni <= 0) {
    return {
      value: fmtUSD(cfo),
      formula: `Net income ${fmtUSD(ni)} · cash from operations ${fmtUSD(cfo)}`,
      tone: cfo > 0 ? "warn" : "bad",
      label: cfo > 0 ? "Loss, but cash-generative" : "Loss, and burning cash",
      note:
        "The company reported a net loss, so a conversion ratio isn't meaningful. What matters then is whether operations still threw off cash — here, " +
        (cfo > 0 ? "they did." : "they did not."),
    };
  }
  const ratio = cfo / ni;
  const tone = ratio >= 1 ? "good" : ratio >= 0.6 ? "ok" : "warn";
  const label = ratio >= 1 ? "Cash-backed" : ratio >= 0.6 ? "Mostly cash-backed" : "Thinly cash-backed";
  return {
    value: fmtX(ratio, 2),
    formula: `Cash from ops ${fmtUSD(cfo)} ÷ net income ${fmtUSD(ni)}`,
    tone,
    label,
    note: "How much of reported profit showed up as operating cash. Above 1× is reassuring; well below suggests earnings lean on accruals. One year is noisy — growth and working-capital swings distort it, and this is operating cash, not free cash. Watch the multi-year trend.",
  };
}

// Leverage: how many years of operating profit would repay the debt?
export function leverage(c) {
  const debt = c?.lines?.totalDebt;
  const oi = c?.lines?.operatingIncome;
  if (debt == null || oi == null) return null;
  if (debt === 0)
    return { value: "0×", formula: "No interest-bearing debt reported", tone: "good", label: "Debt-free", note: "The business doesn't depend on lenders — the strongest position to negotiate, wait, or weather a bad year from." };
  if (oi <= 0)
    return { value: "—", formula: `Total debt ${fmtUSD(debt)} · operating income ${fmtUSD(oi)}`, tone: "bad", label: "Debt against an operating loss", note: "There's debt but no operating profit to measure it against — understand that combination before anything else about the company." };
  const years = debt / oi;
  const tone = years < 2 ? "good" : years < 4 ? "ok" : years < 6 ? "warn" : "bad";
  const label = years < 2 ? "Conservative" : years < 4 ? "Moderate" : years < 6 ? "Heavy" : "High";
  return {
    value: `${years.toFixed(1)}×`,
    formula: `Total debt ${fmtUSD(debt)} ÷ operating income ${fmtUSD(oi)}`,
    tone,
    label,
    note: "Years of operating profit it would take to repay all debt. A first read, not a credit rating: it's gross debt (not netted against cash) over EBIT (not EBITDA), and a cyclical year distorts it.",
  };
}

// Capex vs. depreciation: a lens, not a grade.
export function capexVsDepreciation(c) {
  const capex = c?.lines?.capex;
  const dep = c?.lines?.depreciation;
  if (capex == null || dep == null || dep === 0) return null;
  const ratio = capex / dep;
  const label = ratio < 0.8 ? "Harvesting" : ratio <= 1.2 ? "Maintaining" : "Expanding";
  return {
    value: fmtX(ratio, 2),
    formula: `Capex ${fmtUSD(capex)} ÷ depreciation ${fmtUSD(dep)}`,
    tone: "info",
    label,
    note: "Descriptive, not a grade. Above ~1× means investing faster than assets wear out (growth — or, sustained for years, today's earnings carrying less depreciation than tomorrow's will). Below means spending less than it's wearing out (efficiency — or a melting asset base). The ratio won't tell you which; the filings will.",
  };
}

// Assemble the panel. Uniform shape per check; missing inputs become honest gaps.
export function buildScorecard(company) {
  const cov = coverage(company);
  const covV = coverageVerdict(cov);
  const coverageCheck = {
    key: "coverage",
    title: "Can it pay its interest?",
    href: "/tools/coverage",
    value: cov?.ratio != null ? `${cov.ratio.toFixed(1)}×` : "—",
    formula: cov && !cov.noBurden ? `Operating income ${fmtUSD(cov.oi)} ÷ interest expense ${fmtUSD(cov.interest)}` : "Little or no interest expense reported",
    tone: covV.tone,
    label: covV.label,
    note: covV.note,
  };

  const more = [
    { key: "quality", title: "Are earnings backed by cash?", result: earningsQuality(company) },
    { key: "leverage", title: "How heavy is the debt?", result: leverage(company) },
    { key: "capex", title: "Investing or harvesting?", result: capexVsDepreciation(company) },
  ].map((r) =>
    r.result
      ? { key: r.key, title: r.title, ...r.result }
      : { key: r.key, title: r.title, value: "—", formula: "", tone: "none", label: "Not enough data", note: "The filing data didn't include the inputs for this check." }
  );

  return { checks: [coverageCheck, ...more] };
}
