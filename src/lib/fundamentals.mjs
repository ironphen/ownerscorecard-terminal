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
  none: "#777",
};
