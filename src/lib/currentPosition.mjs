// The Current Position — Value Line's near-term-health box, read instead of merely listed. Works off
// the freshest balance sheet the pipeline captures (company.quarterly), all raw, and derives every
// ratio here so nothing was baked into the data. Pure arithmetic; the page presents it and never
// grades. Withheld for banks/insurers/REITs, whose balance sheets carry no current/non-current split
// and for whom a "current ratio" is meaningless.
import { cashConversionCycle } from "./fundamentals.mjs";

const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const sum = (...xs) => { let s = 0, any = false; for (const x of xs) if (num(x) != null) { s += x; any = true; } return any ? s : null; };

export function currentPosition(company) {
  const q = company?.quarterly;
  const b = q?.balance;
  if (!b) return null;
  const ca = num(b.currentAssets), cl = num(b.currentLiabilities);
  // No current/non-current split (a bank, insurer or REIT presents its balance sheet differently):
  // withhold rather than invent a ratio that means nothing.
  if (ca == null || cl == null) return null;

  const cashLike = sum(b.cash, b.shortTermInvestments) ?? 0;
  const inventory = num(b.inventory);

  // The liquidity ladder, loosest to strictest: everything, then drop inventory, then cash only.
  const currentRatio = cl > 0 ? ca / cl : null;
  const quickRatio = cl > 0 ? (ca - (inventory ?? 0)) / cl : null;
  const cashRatio = cl > 0 ? cashLike / cl : null;
  const workingCapital = ca - cl;

  // Near-term solvency: can the cash on hand cover the debt actually coming due in the next year?
  const debtDue = num(b.currentDebt);
  const debtDueCovered = debtDue != null && debtDue > 0 ? cashLike >= debtDue : null;

  // Graham's deeper floors. Net current asset value (current assets − ALL liabilities), his net-net
  // liquidation cushion; and tangible book (equity stripped of goodwill and intangibles).
  const totalLiabilities = num(b.totalLiabilities);
  const ncav = totalLiabilities != null ? ca - totalLiabilities : null;
  const equity = num(b.stockholdersEquity);
  const tangibleBook = equity != null ? equity - (num(b.goodwill) ?? 0) - (num(b.intangibleAssets) ?? 0) : null;

  // True leverage: debt plus the operating leases ASC 842 put on the balance sheet (the real
  // obligation for a retailer or airline), set beside the cash that offsets it.
  const totalDebt = sum(b.currentDebt, b.longTermDebt);
  const leases = sum(b.operatingLeaseCurrent, b.operatingLeaseNoncurrent);
  const debtPlusLeases = totalDebt != null || leases != null ? (totalDebt ?? 0) + (leases ?? 0) : null;

  // Deferred revenue: cash collected before delivery — float, and a sign customers pre-pay for it.
  const deferredRevenue = sum(b.deferredRevenueCurrent, b.deferredRevenueNoncurrent);

  // Runway, only when the business is genuinely consuming cash: operating cash itself negative, not
  // merely free cash flow. A profitable name that funds heavy growth capex out of operating cash
  // (a utility, an industrial, Amazon) is investing, not burning, so it shows nothing here — the
  // same maintenance-vs-growth-capex distinction owner earnings is careful to draw. When it IS
  // burning, the runway is measured against total free cash flow (the faster, more conservative
  // drain).
  const ttm = company.ttm?.lines || {};
  const fcf = num(ttm.cashFromOps) != null && num(ttm.capex) != null ? ttm.cashFromOps - Math.abs(ttm.capex) : null;
  const burning = num(ttm.cashFromOps) != null && ttm.cashFromOps < -1e6;
  const burnRate = fcf != null && fcf < 0 ? Math.abs(fcf) : (num(ttm.cashFromOps) != null ? Math.abs(ttm.cashFromOps) : null);
  const runwayYears = burning && burnRate && cashLike > 0 ? cashLike / burnRate : null;

  // The liquidity trend across the recent quarters (current ratio + working capital), and the
  // most-recent-quarter revenue momentum versus the same quarter a year earlier.
  const series = (q.series || [])
    .filter((s) => num(s.currentAssets) != null && num(s.currentLiabilities) != null && s.currentLiabilities > 0)
    .map((s) => ({ end: s.end, cr: s.currentAssets / s.currentLiabilities, wc: s.currentAssets - s.currentLiabilities }));

  const revQs = (q.series || []).filter((s) => num(s.revenue) != null);
  let revMomentum = null;
  if (revQs.length >= 2) {
    const latest = revQs[revQs.length - 1];
    const ly = new Date(latest.end); ly.setUTCFullYear(ly.getUTCFullYear() - 1);
    const target = ly.getTime();
    const yearAgo = revQs.find((s) => Math.abs(new Date(s.end).getTime() - target) <= 25 * 86400000);
    if (yearAgo && yearAgo.revenue > 0)
      revMomentum = { end: latest.end, yoY: latest.revenue / yearAgo.revenue - 1, latest: latest.revenue, prior: yearAgo.revenue };
  }

  // The teaching nuance Value Line skips: a current ratio under 1 is usually weakness, but for a
  // business that collects from customers before it pays suppliers it is structural strength — float,
  // not fragility. Two ways to see it: a confirmed negative cash-conversion cycle (the cleanest), or,
  // when that can't be computed (a cash-and-carry retailer like Costco reports almost no receivables),
  // a sub-1 ratio whose near-term liabilities are operating — payables and deferred revenue, not debt.
  const ccc = cashConversionCycle(company);
  const opLiab = (num(b.accountsPayable) ?? 0) + (num(b.deferredRevenueCurrent) ?? 0);
  const debtDueShare = cl > 0 && debtDue != null ? debtDue / cl : null;
  let floatKind = null;
  if (currentRatio != null && currentRatio < 1) {
    if (ccc && /Negative/.test(ccc.label || "")) floatKind = "cycle";
    else if (debtDueShare != null && debtDueShare < 0.2 && opLiab >= 0.45 * cl) floatKind = "operating";
  }

  return {
    asOf: q.asOf || null,
    fresh: q.form === "10-Q", // a real quarter newer than the 10-K, vs. the fiscal year-end
    currentAssets: ca, currentLiabilities: cl, cashLike, inventory,
    components: {
      cash: num(b.cash), shortTermInvestments: num(b.shortTermInvestments), receivables: num(b.receivables),
      inventory, accountsPayable: num(b.accountsPayable), debtDue,
    },
    currentRatio, quickRatio, cashRatio, workingCapital,
    debtDue, debtDueCovered,
    ncav, tangibleBook, totalDebt, leases, debtPlusLeases, deferredRevenue,
    runwayYears, burning,
    series, revMomentum, floatKind,
    cccLabel: ccc?.label || null,
  };
}
