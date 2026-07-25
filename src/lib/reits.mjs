// REITs: a property trust charges depreciation against buildings that usually hold or grow their
// value, so GAAP earnings bury what the properties actually produce. The industry answers that with
// funds from operations — and as of 2026-07-25 this file no longer computes it, because the REIT
// desk established that no filer tags it and that rebuilding it from the standard tags misses the
// reported figure by up to half. See the note on ffo() below.
//
// What is read instead is cash: operating cash flow, what remains after the year's capital
// spending, and whether the distribution is covered by it. That is a harder test than the
// industry's own and it uses only filed, audited figures. Leverage matters as much — every REIT
// carries it — and is read with an under-capture guard. Net asset value and occupancy need cap
// rates and operating detail we do not force.

import { fmtMoney, currencySymbol } from "./fundamentals.mjs";

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pc = (v, dp = 0) => (v == null ? "—" : `${v < 0 ? "−" : ""}${(Math.abs(v) * 100).toFixed(dp)}%`);

// WITHDRAWN 2026-07-25, and the reason is worth keeping in front of whoever reads this next.
//
// Funds from operations is defined by a trade association rather than by accounting standards, and
// the REIT desk's survey established that it is not tagged in XBRL AT ALL: across five FY2025
// filings read in full — Prologis, Simon, Realty Income, AvalonBay, Boston Properties — no
// extension schema declares an element named for it and no inline fact carries one. So it cannot
// be read, only rebuilt, and rebuilding it from the stock tags does not work:
//
//   Simon Property, FY2025: our formula gives +50.2% more than the figure a shareholder is
//   entitled to, because a $2.9bn gain on sale sits behind a custom tag we cannot see.
//   Prologis: within 4.8%, but only because an $686m error and a $551m error point opposite ways.
//   Correct the gain alone and the miss WIDENS to −7.2%. Boston Properties reads 0.82% against one
//   of its two reported figures and −9.2% against the other, again by cancellation.
//
// Two of the five were close for the wrong reason, and there is no way to know ex ante which case
// a given REIT is. A number that is right by coincidence is a wrong number nobody has caught yet,
// so this returns nothing and the surfaces say why. What replaces it is cash: operating cash flow
// is filed, audited and unambiguous, and dividend coverage measured against it answers the
// question FFO was being asked to answer — whether the distribution is earned.
export function ffo() { return null; }

// The reason, in one sentence, for any surface that needs to explain the blank.
export const FFO_WITHHELD_NOTE =
  "Funds from operations is defined by the industry's trade association rather than by accounting rules, and no REIT tags it in the structured data behind this site. Rebuilding it from the standard tags misses the figure these companies report by as much as half, because the gains on property sales it must exclude sit behind each filer's own custom tags. Rather than publish an invented number under the industry's name, the record shows the cash the properties actually produced.";

// Dividend coverage, measured against cash the business actually generated rather than against a
// figure we would have had to invent. This is the harder test and the honest one: FFO adds back
// depreciation without deducting the capital that genuinely keeps buildings competitive, so a
// distribution can look covered on FFO and still be funded by borrowing.
export function cashPayout(L) {
  if (!L || L.dividendsPaid == null || !(L.cashFromOps > 0)) return null;
  return Math.abs(L.dividendsPaid) / L.cashFromOps;
}

// The cash return on what the buildings cost. Gross carrying value, never net: accumulated
// depreciation is the charge this whole industry disputes, and letting it shrink the denominator
// would flatter the return by exactly the amount under argument.
export function cashYieldOnCost(L) {
  if (!L || L.cashFromOps == null || !(L.realEstateGross > 0)) return null;
  return L.cashFromOps / L.realEstateGross;
}

// What these figures do NOT contain. A trust's share of an unconsolidated joint venture — and the
// debt inside it — sits outside every consolidated line on this page, and the pipeline cannot read
// the venture's balance sheet. Leverage you cannot see is what ends compounders, so the gap is
// named rather than left to be discovered. A stated hole is information; a silent one is a claim
// of completeness that has not been earned.
export const JV_LIMITATION_NOTE =
  "These figures are the trust's consolidated accounts. Where a REIT owns buildings through joint ventures it does not control, its share of those properties — and of the debt against them — sits outside every line here, and the filings do not tag it in a form this pipeline can read. Read the equity-method and off-balance-sheet notes in the 10-K before concluding anything about total leverage.";
// Operating cash per share — what funds-from-operations per share was standing in for, built from
// two filed figures instead of a reconstruction. Kept under the old export name so every valuation
// and compare surface that priced a trust on "per share" keeps working on an honest denominator.
export function ffoPerShare(L) {
  return L && L.cashFromOps != null && L.sharesDiluted ? L.cashFromOps / L.sharesDiluted : null;
}
export const PER_SHARE_LABEL = "Operating cash / share";
export function ffoMargin(L) {
  const f = ffo(L);
  if (f == null || !L.revenue) return null;
  const m = f / L.revenue;
  // FFO above revenue is impossible; it means the filing tagged only part of revenue
  // (a lease-heavy REIT often reports total under "Revenues", not contract revenue).
  return m > 1 ? null : m;
}
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
  const ebitda = L.operatingIncome != null && L.depreciation != null ? L.operatingIncome + Math.abs(L.depreciation) : null;
  if (ebitda == null) return null;
  // When net income dwarfs operating income, the operating line is undercaptured — a triple-net
  // REIT earns most of its return through sales-type/direct-financing leases whose income bypasses
  // the operating line — so an EBITDA proxy collapses and a coverage built on it reads falsely thin.
  // Decline rather than print a misleading "bad" (VICI: a 0.4× print against 3.3× on net income).
  if (L.netIncome != null && L.operatingIncome != null && L.netIncome > L.operatingIncome * 2 && L.netIncome > L.interestExpense) return null;
  return ebitda / L.interestExpense;
}

export function buildReitScorecard(company) {
  const L = company?.lines || {};
  const $ = (v) => fmtMoney(v, company?.currency || "USD");
  const sym = currencySymbol(company?.currency || "USD");
  const none = (title, note, concept = null) => ({ title, concept, value: "—", formula: "", tone: "none", label: "Not enough data", note });

  // The FFO block, replaced by the cash it was standing in for. See FFO_WITHHELD_NOTE above:
  // the measure is not tagged by any REIT, and rebuilding it missed Simon Property by half.
  const cash = L.cashFromOps;
  const ffoCheck = {
    title: "Funds from operations",
    concept: "ffo",
    value: "—",
    formula: "",
    tone: "none",
    label: "Withheld — not in the filings' structured data",
    note: FFO_WITHHELD_NOTE,
  };
  // OWNER EARNINGS AS A BOUND, NOT A GUESS (ratified 2026-07-25).
  //
  // Buffett's owner earnings deducts the capital a business needs to hold its competitive position,
  // and he said plainly in 1986 that this term is a guess and sometimes a very difficult one. He
  // made that guess as an investor studying a handful of businesses. Making it here, for two
  // hundred trusts, on filings that deliberately do not separate a new building from a new roof,
  // would be inventing the number rather than estimating it — and management defines the split,
  // which is precisely the incentive Munger warns about.
  //
  // So the two ends are shown and the middle is left to the reader. Operating cash is the CEILING:
  // no owner could have taken out more. Cash less ALL capital spending is the FLOOR, and it is too
  // harsh on purpose, because it charges the owner for buildings being ADDED as though they were
  // being maintained. The truth lies between, and saying so is approximately right where a single
  // modelled figure would be precisely wrong.
  const capex = L.capex != null ? Math.abs(L.capex) : null;
  const floor = cash != null && capex != null ? cash - capex : null;
  const cashCheck = cash == null ? none("What an owner could take out", "Operating cash flow wasn't found in the filing data.", "owner-earnings") : {
    title: "What an owner could take out",
    concept: "owner-earnings",
    value: floor != null ? `${$(floor)} to ${$(cash)}` : $(cash),
    formula: floor != null
      ? `Between cash from operations less all capital spending ${$(cash)} − ${$(capex)} = ${$(floor)}, and cash from operations ${$(cash)}`
      : `Cash from operations ${$(cash)} · capital spending not separately filed`,
    tone: "info",
    label: floor != null ? "A range, because the filings do not split maintenance from expansion" : "Before capital spending",
    note: "Owner earnings is what a business produces in cash after the spending needed to keep it competitive. For a property trust that spending cannot be read: the filings mix the money that replaces a roof with the money that buys a building, and management decides which is which. Rather than model the split and publish a single figure, the two ends are shown. The upper end is operating cash, which no owner could exceed. The lower end deducts every dollar of capital spending, which is too harsh, since a trust that is growing is charged for buildings it is adding. A trust whose distribution sits near the lower end is paying it out of the properties; one whose distribution exceeds the upper end is paying it from somewhere else.",
  };

  // Yield on what the buildings cost, which is how Buffett described measuring the two properties he
  // bought himself in the 2013 letter: the normalised cash return on the price paid, and whether it
  // grows. Gross carrying value rather than net, so accumulated depreciation — the very charge the
  // industry disputes — cannot flatter the denominator.
  const yieldOnCost = cashYieldOnCost(L);
  const yieldCheck = yieldOnCost == null ? none("Cash yield on the properties", "Operating cash flow or the property cost wasn't found in the filing data.", "roic") : {
    title: "What the properties yield on their cost",
    concept: "roic",
    value: pc(yieldOnCost, 1),
    formula: `Cash from operations ${$(cash)} ÷ real estate at cost ${$(L.realEstateGross)}`,
    tone: yieldOnCost < 0.04 ? "warn" : yieldOnCost < 0.07 ? "ok" : "good",
    label: yieldOnCost < 0.04 ? "Thin against what the buildings cost" : yieldOnCost < 0.07 ? "Ordinary for property" : "Strong against cost",
    note: "The cash the properties throw off, measured against what they cost to acquire and build rather than against a market value nobody filed. Read it across the record: a portfolio whose yield on cost is rising is either raising rents faster than it is adding buildings, or buying well. Gross cost is used deliberately, so accumulated depreciation cannot shrink the denominator and flatter the return.",
  };

  const payout = cashPayout(L);
  const payoutCheck = payout == null ? none("Dividend coverage", "Dividends or operating cash flow missing.", "free-cash-flow") : {
    title: "Is the distribution covered by cash?",
    concept: "free-cash-flow",
    value: pc(payout), formula: `Dividends ${$(Math.abs(L.dividendsPaid))} ÷ cash from operations ${$(cash)}`,
    tone: payout > 1 ? "bad" : payout > 0.9 ? "warn" : payout > 0.5 ? "good" : "ok",
    label: payout > 1 ? "Not covered by operating cash" : payout > 0.9 ? "Tight" : payout > 0.5 ? "Covered" : "Lightly covered",
    note: "A REIT must distribute most of its taxable income, so a high payout is normal and the question is whether the cash covers it. This is a harder test than the industry's usual one: funds from operations adds depreciation back without deducting the capital that genuinely keeps buildings competitive, so a distribution can look covered on that measure and still be funded by borrowing or by selling buildings. Above 100% of operating cash, it is being funded by something other than the properties.",
  };
  const lev = debtToAssets(L);
  const levCheck = lev == null ? (debtUnderCaptured(L)
    ? { title: "Debt / assets", concept: "net-debt", value: "—", formula: "", tone: "none", label: "Not cleanly captured", note: "This REIT tags its borrowings in a way the pipeline could not fully total, so we decline to show a leverage figure rather than a misleadingly low one. The debt schedule in the 10-K is where to read its true leverage." }
    : none("Leverage", "Debt or total assets missing.", "net-debt")) : {
    title: "Debt / assets",
    concept: "net-debt",
    value: pc(lev), formula: `Total debt ${$(L.totalDebt)} ÷ assets ${$(L.totalAssets)}`,
    tone: lev > 0.6 ? "bad" : lev > 0.5 ? "warn" : lev > 0.4 ? "ok" : "good",
    label: lev > 0.6 ? "Heavy" : lev > 0.5 ? "Elevated" : lev > 0.4 ? "Moderate" : "Conservative",
    note: "Every REIT runs on leverage; how much is the question. Heavy debt is what turns a property downturn into a wipeout, as 2008 showed, so a conservative balance sheet is part of the moat here, not a drag on it.",
  };
  const cov = ebitdaCoverage(L);
  const covCheck = cov == null ? none("Interest coverage", "Operating income or interest is missing, or operating income sits far below net income (a triple-net REIT's lease income bypasses the operating line), so an EBITDA coverage would mislead — read it on net income against the interest bill, and on debt / assets, instead.", "interest-coverage") : {
    title: "Interest coverage (EBITDA)",
    concept: "interest-coverage",
    value: `${cov.toFixed(1)}×`, formula: `(operating income + depreciation) ÷ interest ${$(L.interestExpense)}`,
    tone: cov < 2 ? "bad" : cov < 3 ? "warn" : cov < 4 ? "ok" : "good",
    label: cov < 2 ? "Thin" : cov < 3 ? "Adequate" : cov < 4 ? "Comfortable" : "Strong",
    note: "How many times the property cash earnings cover the interest bill. Comfortable coverage is what lets a REIT refinance through a tight credit market instead of being forced to sell into one.",
  };

  // The joint-venture gap is attached to the leverage section, because that is where it would
  // change a reader's conclusion: a trust can look conservatively financed on its consolidated
  // balance sheet and carry its real leverage in ventures that never appear on it.
  const jvCheck = {
    title: "What these figures leave out",
    concept: "net-debt",
    value: "—",
    formula: "",
    tone: "none",
    label: "Consolidated accounts only",
    note: JV_LIMITATION_NOTE,
  };

  return {
    sections: [
      { heading: "Is it a good business?", checks: [cashCheck, yieldCheck, payoutCheck, ffoCheck] },
      { heading: "Is it sound?", checks: [levCheck, covCheck, jvCheck] },
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
  const payout = cashPayout(company.lines || {});
  const lev = debtToAssets(company.lines || {});

  // The prose follows the measure. It used to say "funds from operations per share"; the figure
  // underneath is now operating cash per share, and a sentence that named the wrong measure would
  // be its own small wrong number.
  let s1;
  if (g == null) s1 = "Operating cash per share does not form a clean trend in the record";
  else if (g >= 0.04) s1 = `Operating cash per share has compounded about ${pc(g)} a year across the record`;
  else if (g >= 0) s1 = `Operating cash per share has been roughly flat (${pc(g)} a year)`;
  else s1 = `Operating cash per share has shrunk (${pc(g)} a year)`;
  s1 += ".";

  let s2 = "";
  if (payout != null) s2 += ` The dividend takes ${pc(payout)} of FFO, ${payout > 1 ? "more than it earns" : payout > 0.95 ? "leaving little cushion" : "and is covered"}.`;
  if (lev != null) s2 += ` Debt is ${pc(lev)} of assets, ${lev > 0.55 ? "heavy" : lev > 0.4 ? "moderate" : "conservative"} for a REIT.`;

  const s3 = " The quality and location of the properties, the lease terms and occupancy, and the cost of the debt are what the 10-K settles, and no single ratio captures them.";
  return { text: s1 + s2 + s3 };
}
