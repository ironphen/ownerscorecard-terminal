// REITs: a property trust is read on funds from operations (FFO), not GAAP earnings.
// The depreciation a REIT charges against buildings that usually hold or grow their
// value buries the real cash earnings, so FFO adds it back: net income + real-estate
// depreciation − gains on property sales. The questions an owner asks: is FFO per
// share growing, is the dividend covered by it, and is the leverage every REIT
// carries kept sound. Pure arithmetic on the filings. Net asset value and occupancy
// need cap rates and operating detail we do not force.

import { fmtUSD } from "./fundamentals.mjs";

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const pc = (v, dp = 0) => (v == null ? "—" : `${v < 0 ? "−" : ""}${(Math.abs(v) * 100).toFixed(dp)}%`);

export function ffo(L) {
  if (!L || L.netIncome == null || L.depreciation == null) return null;
  return L.netIncome + L.depreciation - (L.gainOnSaleRealEstate || 0);
}
export function ffoPerShare(L) { const f = ffo(L); return f != null && L.sharesDiluted ? f / L.sharesDiluted : null; }
export function ffoMargin(L) { const f = ffo(L); return f != null && L.revenue ? f / L.revenue : null; }
export function ffoOnAssets(L) { const f = ffo(L); return f != null && L.totalAssets ? f / L.totalAssets : null; }
export function ffoPayout(L) { const f = ffo(L); return f != null && f > 0 && L.dividendsPaid != null ? Math.abs(L.dividendsPaid) / f : null; }
export function debtToAssets(L) {
  if (!L || L.totalDebt == null || !L.totalAssets) return null;
  const r = L.totalDebt / L.totalAssets;
  // Under-capture guard: a property trust at near-zero leverage, or one whose
  // reported debt implies an absurd interest rate, almost always means the filing
  // tags its borrowings in a way the pipeline did not fully total. Decline the figure
  // rather than print a misleadingly low one.
  if (r < 0.1) return null;
  if (L.interestExpense != null && L.totalDebt > 0 && L.interestExpense / L.totalDebt > 0.12) return null;
  return r;
}
export function debtUnderCaptured(L) {
  return !!(L && L.totalDebt != null && L.totalAssets && debtToAssets(L) == null);
}
export function ebitdaCoverage(L) {
  if (!L || !L.interestExpense || L.interestExpense <= 0) return null;
  const ebitda = L.operatingIncome != null && L.depreciation != null ? L.operatingIncome + L.depreciation : null;
  return ebitda != null ? ebitda / L.interestExpense : null;
}

export function buildReitScorecard(company) {
  const L = company?.lines || {};
  const none = (title, note) => ({ title, value: "—", formula: "", tone: "none", label: "Not enough data", note });

  const f = ffo(L), fps = ffoPerShare(L);
  const ffoCheck = f == null ? none("Funds from operations", "Net income or depreciation wasn't found in the filing data.") : {
    title: "Funds from operations (FFO)",
    value: fmtUSD(f),
    formula: `Net income ${fmtUSD(L.netIncome)} + depreciation ${fmtUSD(L.depreciation)}${L.gainOnSaleRealEstate ? ` − gains on sale ${fmtUSD(L.gainOnSaleRealEstate)}` : ""}`,
    tone: "info", label: fps != null ? `about $${fps.toFixed(2)} per share` : "the REIT earnings measure",
    note: "GAAP net income with property depreciation added back, because the buildings a REIT charges against earnings usually hold or grow their value. This, not net income, is what a REIT is actually priced on. It is an approximation here: where a filing reports gains on property sales, we remove them, the way the NAREIT definition does.",
  };
  const payout = ffoPayout(L);
  const payoutCheck = payout == null ? none("Dividend coverage", "FFO or dividends missing.") : {
    title: "Dividend / FFO (payout)",
    value: pc(payout), formula: `Dividends ${fmtUSD(Math.abs(L.dividendsPaid))} ÷ FFO ${fmtUSD(f)}`,
    tone: payout > 1 ? "bad" : payout > 0.95 ? "warn" : payout > 0.6 ? "good" : "ok",
    label: payout > 1 ? "Not covered by FFO" : payout > 0.95 ? "Tight" : payout > 0.6 ? "Covered" : "Lightly covered",
    note: "A REIT must distribute most of its taxable income, so a high payout is normal and the question is whether FFO covers it. Above 100%, the trust is funding the dividend with debt or asset sales, and a cut usually follows.",
  };
  const lev = debtToAssets(L);
  const levCheck = lev == null ? (debtUnderCaptured(L)
    ? { title: "Debt / assets", value: "—", formula: "", tone: "none", label: "Not cleanly captured", note: "This REIT tags its borrowings in a way the pipeline could not fully total, so we decline to show a leverage figure rather than a misleadingly low one. The debt schedule in the 10-K is where to read its true leverage." }
    : none("Leverage", "Debt or total assets missing.")) : {
    title: "Debt / assets",
    value: pc(lev), formula: `Total debt ${fmtUSD(L.totalDebt)} ÷ assets ${fmtUSD(L.totalAssets)}`,
    tone: lev > 0.6 ? "bad" : lev > 0.5 ? "warn" : lev > 0.4 ? "ok" : "good",
    label: lev > 0.6 ? "Heavy" : lev > 0.5 ? "Elevated" : lev > 0.4 ? "Moderate" : "Conservative",
    note: "Every REIT runs on leverage; how much is the question. Heavy debt is what turns a property downturn into a wipeout, as 2008 showed, so a conservative balance sheet is part of the moat here, not a drag on it.",
  };
  const cov = ebitdaCoverage(L);
  const covCheck = cov == null ? none("Interest coverage", "Operating income or interest missing.") : {
    title: "Interest coverage (EBITDA)",
    value: `${cov.toFixed(1)}×`, formula: `(operating income + depreciation) ÷ interest ${fmtUSD(L.interestExpense)}`,
    tone: cov < 2 ? "bad" : cov < 3 ? "warn" : cov < 4 ? "ok" : "good",
    label: cov < 2 ? "Thin" : cov < 3 ? "Adequate" : cov < 4 ? "Comfortable" : "Strong",
    note: "How many times the property cash earnings cover the interest bill. Comfortable coverage is what lets a REIT refinance through a tight credit market instead of being forced to sell into one.",
  };

  return {
    sections: [
      { heading: "Is it a good business?", checks: [ffoCheck, payoutCheck] },
      { heading: "Is it sound?", checks: [levCheck, covCheck] },
    ],
  };
}

// The brief's "is it a good business?" read for a REIT: FFO-per-share growth across
// the record, dividend coverage and leverage, with the verdict left to the filing.
export function reitQuality(company) {
  const H = (company?.history || []).filter((h) => ffoPerShare(h.lines) != null);
  if (H.length < 3) return null;
  const s = H.map((h) => ffoPerShare(h.lines));
  const first = s[0], last = s[s.length - 1], span = s.length - 1;
  const g = first > 0 && last > 0 ? Math.pow(last / first, 1 / span) - 1 : null;
  const payout = ffoPayout(company.lines || {});
  const lev = debtToAssets(company.lines || {});

  let s1;
  if (g == null) s1 = "Funds from operations per share do not form a clean trend in the record";
  else if (g >= 0.04) s1 = `Funds from operations per share have compounded about ${pc(g)} a year across the record`;
  else if (g >= 0) s1 = `Funds from operations per share have been roughly flat (${pc(g)} a year)`;
  else s1 = `Funds from operations per share have shrunk (${pc(g)} a year)`;
  s1 += ".";

  let s2 = "";
  if (payout != null) s2 += ` The dividend takes ${pc(payout)} of FFO, ${payout > 1 ? "more than it earns" : payout > 0.95 ? "leaving little cushion" : "and is covered"}.`;
  if (lev != null) s2 += ` Debt is ${pc(lev)} of assets, ${lev > 0.55 ? "heavy" : lev > 0.4 ? "moderate" : "conservative"} for a REIT.`;

  const s3 = " The quality and location of the properties, the lease terms and occupancy, and the cost of the debt are what the 10-K settles, and no single ratio captures them.";
  return { text: s1 + s2 + s3 };
}
