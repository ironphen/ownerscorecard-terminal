// valuationInputs.mjs — the numeric inputs to the reverse-DCF, derived once from a company's record
// so the company-page valuation (Valuation.astro) and the head-to-head compare view feed the SAME
// figures into the shared reverse-DCF math (reverseDcf.mjs). Pure: no DOM, no formatting.
//
// "What the price implies" depends on a base (owner earnings, tangible book, or FFO), the growth the
// record actually delivered, net debt and the share count — and on which lens the business is read
// through. This module computes all of that and picks the lens, by the exact same logic the company
// page uses, so the two surfaces can never disagree on the figures behind the answer.

import { classify, financialKind, financialSubtype } from "./archetype.mjs";
import { liquidAssets, maintenanceCapex, ownerEarningsAbs } from "./fundamentals.mjs";
import { tangibleEquity } from "./financials.mjs";
import { ffoPerShare } from "./reits.mjs";
import { earningsPower } from "./normalize.mjs";

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Delivered growth a series actually compounded at, fit across ALL its points by a log-linear
// regression rather than two endpoints. A single trough or peak year cannot anchor the rate, and a
// structural step is read as the trend through it, not erased by which endpoint the window lands on.
// Positive points only; a near-zero outlier year (below a tenth of the median) is dropped before the
// fit. This is the exact estimator the company page uses for its delivered-growth anchors — shared
// here so the compare view's delivered-vs-implied read matches the company page to the digit.
export function trendGrowth(series) {
  let v = (series || []).filter((x) => x != null && x > 0);
  if (v.length < 4) return null;
  const sorted = [...v].sort((a, b) => a - b), med = sorted[Math.floor(v.length / 2)];
  if (med > 0) v = v.filter((x) => x >= med * 0.1);
  if (v.length < 4) return null;
  const n = v.length, ys = v.map((x) => Math.log(x)), mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (ys[i] - my); den += (i - mx) ** 2; }
  return den === 0 ? null : Math.exp(num / den) - 1;
}

// Owner-earnings growth over a recent 5-year window: 2-year-averaged endpoints, so one noisy year
// can't drive it. The figure the reference value extrapolates, when the record is long enough.
function deliveredOe(pts) {
  if (pts.length < 4) return null;
  const early = (pts[0].v + pts[1].v) / 2;
  const late = (pts[pts.length - 1].v + pts[pts.length - 2].v) / 2;
  const yrs = pts[pts.length - 1].fy - pts[0].fy;
  return early > 0 && late > 0 && yrs > 0 ? Math.pow(late / early, 1 / yrs) - 1 : null;
}

// Everything the reverse-DCF needs, and which lens to read it through. Mirrors Valuation.astro's
// frontmatter derivations exactly (the `L = ttm ?? annual` base, the owner-earnings/maintenance/
// normalized bases, the bank and REIT bases, the negative-owner-earnings fallback, and the mode
// precedence) so a card built from this reproduces the company page's "What the price implies".
export function valuationModel(company) {
  const fk = financialKind(company);
  const isInsurer = fk === "insurer";
  const isBank = fk === "bank" || fk === "insurer";
  const isReit = fk === "reit";
  const offModel = isBank || isReit;

  const L = company.ttm?.lines || company.lines || {};
  const shares = L.sharesDiluted ?? company.lines?.sharesDiluted ?? null;
  const cfo = L.cashFromOps, capex = L.capex;
  const ownerEarnings = cfo != null && capex != null ? cfo - Math.abs(capex) : null;
  const netDebt = (L.totalDebt || 0) - (liquidAssets(L) || 0);

  const niH = (company.history || []).filter((h) => h?.lines?.netIncome != null).slice(-3).map((h) => h.lines.netIncome);
  const eps3 = niH.length >= 2 && shares ? niH.reduce((a, b) => a + b, 0) / niH.length / shares : null;
  const bvps = L.stockholdersEquity != null && shares ? L.stockholdersEquity / shares : null;

  const oeHist = (company.history || []).map((h) => (h.lines.cashFromOps != null && h.lines.capex != null ? h.lines.cashFromOps - Math.abs(h.lines.capex) : null));
  const oe3vals = [...oeHist].reverse().filter((v) => v != null).slice(0, 3);
  const oe3 = oe3vals.length >= 2 ? oe3vals.reduce((a, b) => a + b, 0) / oe3vals.length : ownerEarnings;
  const oeNormalized = earningsPower(company)?.normOE ?? oe3;
  const sbc = L.stockBasedComp ?? company.lines?.stockBasedComp ?? 0;

  const maintCx = maintenanceCapex(company);
  const ownerEarningsMaint = cfo != null && maintCx != null ? cfo - maintCx : null;
  const oeHistMaint = (company.history || []).map((h) => (h.lines.cashFromOps != null && h.lines.depreciation != null ? h.lines.cashFromOps - h.lines.depreciation : null));
  const oem3vals = [...oeHistMaint].reverse().filter((v) => v != null).slice(0, 3);
  const oe3Maint = oem3vals.length >= 2 ? oem3vals.reduce((a, b) => a + b, 0) / oem3vals.length : ownerEarningsMaint;
  const offerMaint = ownerEarningsMaint != null && ownerEarnings != null && maintCx != null && capex != null && maintCx < Math.abs(capex) * 0.9;

  const oeSeries = oeHist.filter((v) => v != null);
  const gDelivTrend = trendGrowth(oeSeries.slice(-8));
  const oeAbsHist = (company.history || []).filter((h) => h?.lines?.revenue != null).map((h) => ({ fy: h.fy, v: ownerEarningsAbs(h.lines, company) })).filter((p) => p.v != null);
  const gDeliv5 = oeAbsHist.length > 5 ? deliveredOe(oeAbsHist.slice(-5)) : null;
  const gDeliv = gDeliv5 ?? gDelivTrend; // the reference-value anchor, exactly as Valuation's data-gdeliv

  const maintBasePos = offerMaint && (((ownerEarningsMaint ?? -1) > 0) || ((oe3Maint ?? -1) > 0));
  const normBasePos = (oeNormalized ?? -1) > 0;
  const defaultMaint = !(ownerEarnings > 0) && maintBasePos;
  const defaultNorm = !(ownerEarnings > 0) && !defaultMaint && normBasePos;
  const runnable = (ownerEarnings != null && ownerEarnings > 0) || defaultMaint || defaultNorm;

  // Bank / insurer: a multiple of tangible book set by the return on it.
  const tEq = tangibleEquity(L);
  const tbvps = tEq != null && shares ? tEq / shares : null;
  const bvpsBank = L.stockholdersEquity != null && shares ? L.stockholdersEquity / shares : null;
  const epsBank = L.netIncome != null && shares ? L.netIncome / shares : null;
  const rotceH = (company.history || []).map((h) => { const t = tangibleEquity(h.lines); return h.lines.netIncome != null && t && t > 0 ? h.lines.netIncome / t : null; }).filter((v) => v != null);
  const rotce = rotceH.length >= 3 ? median(rotceH) : null;
  const bankRunnable = isBank && tbvps != null && tbvps > 0 && rotce != null;
  const tbvpsH = (company.history || []).map((h) => { const t = tangibleEquity(h.lines); const s = h.lines.sharesDiluted; return t != null && s ? t / s : null; }).filter((v) => v != null);
  const tbvGrowth = trendGrowth(tbvpsH.slice(-6));

  // REIT: a multiple of funds from operations.
  const ffops = ffoPerShare(L);
  const dpsReit = L.dividendsPaid != null && shares ? Math.abs(L.dividendsPaid) / shares : null;
  const ffopsH = (company.history || []).map((h) => ffoPerShare(h.lines)).filter((v) => v != null);
  const ffoGrowth = trendGrowth(ffopsH.slice(-6));
  const reitRunnable = isReit && ffops != null && ffops > 0 && shares != null && shares > 0;

  // Negative owner earnings: flip the question to the profitability a price demands.
  const rev = L.revenue;
  const revH = (company.history || []).map((h) => h.lines.revenue).filter((v) => v != null);
  const gRev = trendGrowth(revH.slice(-6));
  const negMode = !runnable && !offModel && rev != null && rev > 0 && shares != null && shares > 0;
  const oeMarginNow = ownerEarnings != null && rev ? ownerEarnings / rev : null;
  const niNow = L.netIncome ?? company.lines?.netIncome ?? null;
  const profitableNeg = niNow != null && niNow > 0;

  // Which lens the company page renders, by the same precedence as its template.
  let mode;
  if (offModel) mode = reitRunnable ? "reit" : bankRunnable ? "bank" : "off";
  else if (!runnable) mode = negMode ? "negative" : "off";
  else mode = "owner-earnings";

  const finKind = isInsurer ? "insurer" : financialSubtype(company) === "mortgage-reit" ? "mortgage REIT" : isReit ? "REIT" : "bank";

  return {
    mode, offModel, runnable, negMode, bankRunnable, reitRunnable, isBank, isInsurer, isReit, finKind,
    shares, netDebt,
    oe: ownerEarnings, oeNormalized, oeMaint: ownerEarningsMaint, oe3, oe3Maint, sbc, offerMaint, defaultMaint, defaultNorm,
    eps3, bvps, gDeliv, rev, gRev, ni: niNow,
    tbvps, bvpsBank, epsBank, rotce, tbvGrowth,
    ffops, dpsReit, ffoGrowth,
    oeMarginNow, profitableNeg,
  };
}
