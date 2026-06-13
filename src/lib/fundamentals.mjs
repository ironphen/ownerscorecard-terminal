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

// Return on invested capital — Buffett's north star.
export function roic(c) {
  const L = c?.lines || {};
  const oi = L.operatingIncome, eq = L.stockholdersEquity, debt = L.totalDebt;
  if (oi == null || eq == null || debt == null) return null;
  const invested = debt + eq - (L.cashAndEquivalents || 0);
  if (invested <= 0)
    return {
      value: "—",
      formula: `Invested capital ${fmtUSD(invested)} = debt ${fmtUSD(debt)} + equity ${fmtUSD(eq)} − cash`,
      tone: "none",
      label: "Not meaningful here",
      note: "Invested capital is near zero or negative — usually years of buybacks pulling equity down. ROIC explodes or flips sign and stops meaning anything. Judge this one on Owner Earnings instead.",
    };
  // Effective tax rate from the filing (pretax ≈ net income + tax); fallback 21%.
  let t = 0.21;
  const tax = L.incomeTaxExpense, ni = L.netIncome;
  if (tax != null && ni != null && ni + tax > 0) t = Math.min(Math.max(tax / (ni + tax), 0), 0.5);
  const nopat = oi * (1 - t);
  const r = nopat / invested;
  const tone = r < 0.08 ? "warn" : r < 0.15 ? "ok" : "good";
  const label = r < 0.08 ? "Below average" : r < 0.15 ? "Solid" : r < 0.25 ? "High" : "Exceptional";
  return {
    value: `${(r * 100).toFixed(0)}%`,
    formula: `NOPAT ${fmtUSD(nopat)} ÷ invested capital ${fmtUSD(invested)} (debt + equity − cash)`,
    tone,
    label,
    note: "The rate the business earns on the money tied up in it — Buffett's north star, because over time a stock tracks the ROIC beneath it. Above ~15% sustained hints at a moat; below ~8% the company may destroy value as it grows. Asset-light businesses (R&D expensed, little capital) read artificially high — pair this with Owner Earnings.",
  };
}

// Owner Earnings (owner earnings): operating cash minus capex — what an owner can take out.
export function ownerCash(c) {
  const L = c?.lines || {};
  const cfo = L.cashFromOps, capex = L.capex;
  if (cfo == null || capex == null) return null;
  const oc = cfo - Math.abs(capex);
  const rev = L.revenue, sbc = L.stockBasedComp;
  const margin = rev ? oc / rev : null;
  const ocSbc = sbc != null ? oc - sbc : null;
  const tone = oc <= 0 ? "bad" : margin == null ? "ok" : margin < 0.05 ? "warn" : margin < 0.15 ? "ok" : "good";
  const label = oc <= 0 ? "Consumes cash" : margin == null ? "Positive" : margin < 0.05 ? "Thin" : margin < 0.15 ? "Solid" : "Cash machine";
  return {
    value: margin != null ? `${(margin * 100).toFixed(0)}%` : fmtUSD(oc),
    formula: `Owner Earnings ${fmtUSD(oc)} = operating cash ${fmtUSD(cfo)} − capex ${fmtUSD(Math.abs(capex))}`,
    tone,
    label,
    note:
      `What an owner could take out without starving the business.${margin != null ? ` That's ${(margin * 100).toFixed(0)}% of revenue.` : ""}` +
      `${ocSbc != null ? ` Treating stock comp as the real expense it is (less ${fmtUSD(sbc)} of SBC) leaves ${fmtUSD(ocSbc)}.` : ""}` +
      " Honest caveat: capex here blends maintenance and growth, so steady-state Owner Earnings may run higher (see capex vs. depreciation).",
  };
}

// Capital allocation: of the Owner Earnings, how much was returned — and was it real?
export function capitalAllocation(c) {
  const L = c?.lines || {};
  const cfo = L.cashFromOps, capex = L.capex, div = L.dividendsPaid, bb = L.buybacks;
  if (cfo == null || capex == null || (div == null && bb == null)) return null;
  const oc = cfo - Math.abs(capex);
  if (oc <= 0)
    return { value: "—", formula: "", tone: "warn", label: "No surplus to allocate", note: "The business didn't generate positive Owner Earnings this year, so any distributions came from the balance sheet or borrowing — not from operations." };
  const dividends = Math.abs(div || 0), buybacks = Math.abs(bb || 0), sbc = L.stockBasedComp;
  const returned = dividends + buybacks;
  const payout = returned / oc;
  const label = payout >= 0.9 ? "Returns most of it" : payout >= 0.4 ? "Returns about half" : "Reinvests most of it";
  let note = `Of ${fmtUSD(oc)} Owner Earnings, ${fmtUSD(returned)} (${(payout * 100).toFixed(0)}%) went back to shareholders — ${fmtUSD(dividends)} dividends, ${fmtUSD(buybacks)} buybacks.`;
  if (buybacks > 0 && sbc != null)
    note += buybacks - sbc <= 0
      ? ` But the buybacks barely exceed stock issued to employees (${fmtUSD(sbc)} SBC) — net of dilution, little was truly returned.`
      : ` Net of ${fmtUSD(sbc)} stock comp, the real buyback was about ${fmtUSD(buybacks - sbc)}.`;
  note += " Returning most of it signals a mature cash machine; reinvesting most could mean a long runway — or empire-building. The split doesn't say which; the return earned on it (see ROIC) does.";
  return { value: `${(payout * 100).toFixed(0)}%`, formula: `Dividends + buybacks ${fmtUSD(returned)} ÷ Owner Earnings ${fmtUSD(oc)}`, tone: "info", label, note };
}

// Cash-conversion cycle: DSO + DIO − DPO (days). A liquidity check that doubles
// as a moat detector — a negative cycle means others fund the business.
export function cashConversionCycle(c) {
  const L = c?.lines || {};
  const rev = L.revenue, cogs = L.costOfRevenue, recv = L.receivables, ap = L.accountsPayable;
  if (rev == null || cogs == null || recv == null || ap == null || cogs <= 0 || rev <= 0) return null;
  const inv = L.inventory;
  const hasInv = inv != null && inv > 0;
  const dso = (recv / rev) * 365;
  const dio = hasInv ? (inv / cogs) * 365 : 0;
  const dpo = (ap / cogs) * 365;
  const ccc = dso + dio - dpo;
  const tone = ccc < 0 ? "good" : ccc < 60 ? "ok" : "warn";
  const label = ccc < 0 ? "Negative — funded by others" : ccc < 60 ? "Tight" : "Capital-hungry";
  return {
    value: `${Math.round(ccc)}d`,
    formula: `DSO ${Math.round(dso)} + DIO ${Math.round(dio)} − DPO ${Math.round(dpo)} days`,
    tone,
    label,
    note:
      "Days cash is tied up between paying suppliers and collecting from customers." +
      (ccc < 0
        ? " A negative cycle is a quiet moat: suppliers and customers fund the operation (Buffett's “float”) — the company grows on other people's money."
        : " Lower is better; a long cycle means growth itself eats cash.") +
      (!hasInv ? " (Little or no inventory — a services / asset-light model, so the inventory leg is ~0.)" : ""),
  };
}

// Raw metric values from a single year's lines — reused for the time series.
// Return null when not honestly computable.
export function roicValue(L) {
  if (!L) return null;
  const oi = L.operatingIncome, eq = L.stockholdersEquity, debt = L.totalDebt;
  if (oi == null || eq == null || debt == null) return null;
  const invested = debt + eq - (L.cashAndEquivalents || 0);
  if (invested <= 0) return null;
  let t = 0.21;
  const tax = L.incomeTaxExpense, ni = L.netIncome;
  if (tax != null && ni != null && ni + tax > 0) t = Math.min(Math.max(tax / (ni + tax), 0), 0.5);
  return (oi * (1 - t)) / invested;
}

export function operatingMargin(L) {
  return L && L.operatingIncome != null && L.revenue ? L.operatingIncome / L.revenue : null;
}

export function ownerEarningsMargin(L) {
  if (!L || L.cashFromOps == null || L.capex == null || !L.revenue) return null;
  return (L.cashFromOps - Math.abs(L.capex)) / L.revenue;
}

// Durability: the same business-quality metrics across ~10 years of filings.
// A moat is high ROIC that doesn't fade — you can only see it over a cycle.
export function durability(company) {
  const hist = company?.history;
  if (!Array.isArray(hist) || hist.length < 3) return null;
  const years = hist.map((h) => h.fy);
  const roic = hist.map((h) => roicValue(h.lines));
  const roicVals = roic.filter((v) => v != null);
  const above = roicVals.filter((v) => v >= 0.15).length;
  return {
    years,
    metrics: [
      {
        label: "Return on invested capital",
        values: roic,
        consistency: roicVals.length ? `≥15% in ${above} of ${roicVals.length} years` : null,
      },
      { label: "Operating margin", values: hist.map((h) => operatingMargin(h.lines)), consistency: null },
      { label: "Owner Earnings margin", values: hist.map((h) => ownerEarningsMargin(h.lines)), consistency: null },
    ],
  };
}

// Assemble the panel, grouped into the two questions Graham and Buffett asked.
export function buildScorecard(company) {
  const cov = coverage(company);
  const covV = coverageVerdict(cov);
  const coverageCheck = {
    title: "Can it pay its interest?",
    href: "/tools/coverage",
    value: cov?.ratio != null ? `${cov.ratio.toFixed(1)}×` : "—",
    formula: cov && !cov.noBurden ? `Operating income ${fmtUSD(cov.oi)} ÷ interest expense ${fmtUSD(cov.interest)}` : "Little or no interest expense reported",
    tone: covV.tone,
    label: covV.label,
    note: covV.note,
  };

  const wrap = (title, result) =>
    result
      ? { title, ...result }
      : { title, value: "—", formula: "", tone: "none", label: "Not enough data", note: "The filing data didn't include the inputs for this check." };

  return {
    sections: [
      {
        heading: "Will it survive?",
        checks: [
          coverageCheck,
          wrap("How heavy is the debt?", leverage(company)),
          wrap("How long is cash tied up?", cashConversionCycle(company)),
        ],
      },
      {
        heading: "Is it a good business?",
        checks: [
          wrap("Return on invested capital", roic(company)),
          wrap("Owner Earnings (free cash) margin", ownerCash(company)),
          wrap("Are earnings backed by cash?", earningsQuality(company)),
        ],
      },
      {
        heading: "How is the cash used?",
        checks: [
          wrap("Where do the earnings go?", capitalAllocation(company)),
          wrap("Investing or harvesting?", capexVsDepreciation(company)),
        ],
      },
    ],
  };
}
