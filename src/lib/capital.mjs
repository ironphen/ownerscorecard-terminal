// Capital allocation over the record, Buffett's "most important job of management."
// Where did the cash the business generated actually go, across the whole span, and on
// what terms: back into the business (capex), out to owners (dividends, buybacks at what
// price), or to the balance sheet. Pure arithmetic on figures the pipeline pulls; the
// report lays the facts in a row and never grades, the owner judges.

// Diluted share counts come straight from each filing, and a stock split restates them: the
// years a later 10-K still covers are reported on the new basis, while older years (no later
// filing reaches back to restate them) stay on the old one, leaving a 4x or 20x cliff in the
// raw series. Left uncorrected it reads as enormous dilution (Apple's 5.5B in 2016 beside its
// 15B in 2025) when the count actually fell by a third. This rescales the series across any
// split-sized jump, snapping the jump to the nearest clean split ratio, so the whole series
// sits on the latest year's basis. Organic change (buybacks, stock pay) passes through.
const SPLIT_RATIOS = [1.5, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20];
function snapSplit(ratio) {
  let best = 1, bestErr = Infinity;
  for (const s of SPLIT_RATIOS) {
    const err = Math.abs(ratio - s) / s;
    if (err < bestErr) { bestErr = err; best = s; }
  }
  return bestErr <= 0.12 ? best : 1; // within 12% of a clean split ratio, else treat as organic
}
// Per-year split factor: walk the diluted-share series and carry the cumulative multiple that
// puts each earlier year onto the latest year's basis. Returned as a Map keyed by fiscal year,
// so one factor serves every per-share quantity the section uses, the share count, the shares
// repurchased, and the dividend per share, and a split distorts none of them.
export function splitFactorsByFy(points) {
  const pts = points.filter((p) => p.shares != null && p.shares > 0);
  const m = new Map();
  if (!pts.length) return m;
  let factor = 1;
  m.set(pts[pts.length - 1].fy, 1);
  for (let i = pts.length - 2; i >= 0; i--) {
    const ratio = pts[i + 1].shares / pts[i].shares;
    if (ratio >= 1.4) factor *= snapSplit(ratio); // forward split between year i and i+1
    else if (ratio <= 1 / 1.4) factor *= 1 / snapSplit(1 / ratio); // reverse split
    m.set(pts[i].fy, factor);
  }
  return m;
}

export function capitalHistory(company) {
  // Require both operating cash and capex each year, so the sources-and-uses split is over a
  // consistent window. The Japanese pool carries operating cash for five years but capex for
  // only the latest two (the five-year-summary limit), so this honestly withholds the card
  // there until the history deepens, rather than show a distorted mix.
  const H = (company.history || []).filter((h) => h?.lines?.cashFromOps != null && h?.lines?.capex != null);
  if (H.length < 4) return null;

  const years = H.map((h) => h.fy);
  const per = H.map((h) => {
    const L = h.lines;
    const oe = L.cashFromOps != null && L.capex != null ? L.cashFromOps - Math.abs(L.capex) : null;
    return {
      fy: h.fy,
      cfo: L.cashFromOps || 0,
      capex: L.capex != null ? Math.abs(L.capex) : 0,
      div: L.dividendsPaid != null ? Math.abs(L.dividendsPaid) : 0,
      bb: L.buybacks != null ? Math.abs(L.buybacks) : 0,
      ni: L.netIncome,
      oe,
      shares: L.sharesDiluted != null && L.sharesDiluted > 0 ? L.sharesDiluted : null,
      repShares: L.repurchasedShares != null && L.repurchasedShares > 0 ? L.repurchasedShares : null,
      dps: L.dividendsPaid != null && L.sharesDiluted ? Math.abs(L.dividendsPaid) / L.sharesDiluted : null,
    };
  });
  const sum = (k) => per.reduce((a, p) => a + (p[k] || 0), 0);
  const cfo = sum("cfo"), capex = sum("capex"), div = sum("div"), bb = sum("bb");
  if (cfo <= 0) return null;

  const returned = div + bb;
  const retained = cfo - capex - div - bb; // debt paydown / cash build / acquisitions (residual)

  const endL = company.ttm?.lines || H[H.length - 1].lines;
  const debtChange = H[0].lines.totalDebt != null && endL.totalDebt != null ? endL.totalDebt - H[0].lines.totalDebt : null;
  const cashChange = H[0].lines.cashAndEquivalents != null && endL.cashAndEquivalents != null ? endL.cashAndEquivalents - H[0].lines.cashAndEquivalents : null;

  const p = (x) => x / cfo;
  let character;
  if (p(returned) >= 0.6) character = "a mature cash machine, most of what it earns goes straight back to owners";
  else if (p(capex) >= 0.5) character = "a reinvestor, most operating cash is plowed back into the business";
  else if (debtChange != null && debtChange < -0.2 * cfo) character = "a deleverager, a meaningful share of cash went to paying down debt";
  else if (cashChange != null && cashChange > 0.25 * cfo) character = "a hoarder, a large share of cash simply built the balance sheet";
  else character = "a balanced allocator, splitting cash between the business, owners, and the balance sheet";

  // ---- the report-card facts ----
  const oeTotal = per.reduce((a, q) => a + (q.oe || 0), 0);

  // One split-adjustment basis for the whole section. Build the diluted-share series (the
  // per-year counts plus the latest TTM count as the most-trusted final point) and derive a
  // factor per year, so a stock split never distorts the buyback price, the share-count change,
  // or the dividend-per-share trajectory that follow.
  const endShares = endL.sharesDiluted && endL.sharesDiluted > 0 ? endL.sharesDiluted : null;
  const sharePoints = per.filter((q) => q.shares != null).map((q) => ({ fy: q.fy, shares: q.shares }));
  const lastHistFy = sharePoints.length ? sharePoints[sharePoints.length - 1].fy : 0;
  if (endShares != null && (!sharePoints.length || endShares !== sharePoints[sharePoints.length - 1].shares))
    sharePoints.push({ fy: lastHistFy + 0.5, shares: endShares });
  const splitFac = splitFactorsByFy(sharePoints);
  const fac = (fy) => splitFac.get(fy) ?? 1;

  // Buybacks at what price: align cash with count, summing only the years that report both, on
  // one split-adjusted basis, so the blended average is cash ÷ shares actually bought stated in
  // today's shares. A close approximation (a year of purchases, any accelerated repurchase),
  // not a tick-by-tick figure.
  const bbYears = per.filter((q) => q.bb > 0 && q.repShares != null);
  const bbSpentPriced = bbYears.reduce((a, q) => a + q.bb, 0);
  const bbSharesPriced = bbYears.reduce((a, q) => a + q.repShares * fac(q.fy), 0);
  const avgBuybackPrice = bbSharesPriced > 0 ? bbSpentPriced / bbSharesPriced : null;

  // Did the diluted share count actually fall? The real test, net of stock issued to staff,
  // on the split-adjusted basis above so a split can't masquerade as dilution (or hide it).
  const firstShareYear = per.find((q) => q.shares != null);
  const lastShareYear = [...per].reverse().find((q) => q.shares != null);
  const firstShares = firstShareYear ? firstShareYear.shares * fac(firstShareYear.fy) : null;
  const lastShares = endShares != null ? endShares : (lastShareYear ? lastShareYear.shares * fac(lastShareYear.fy) : null);
  const shareChange = firstShares != null && lastShares != null && firstShares > 0 ? lastShares / firstShares - 1 : null;

  // Dividend record: years paid, the trajectory of the per-share dividend, and whether it
  // was ever cut (the fact a dividend investor cares about most).
  // Per-share dividend on the split-adjusted basis, so a split is not misread as a dividend cut.
  const dpsSeries = per.map((q) => (q.dps != null ? q.dps / fac(q.fy) : null)).filter((v) => v != null);
  const dpsFirst = dpsSeries.length ? dpsSeries[0] : null;
  const dpsLast = dpsSeries.length ? dpsSeries[dpsSeries.length - 1] : null;
  let everCut = false;
  for (let i = 1; i < dpsSeries.length; i++) if (dpsSeries[i] < dpsSeries[i - 1] * 0.98) everCut = true;
  const divYears = per.filter((q) => q.div > 0).length;
  const dpsGrowth = dpsFirst && dpsLast && dpsFirst > 0 && dpsSeries.length >= 2 ? Math.pow(dpsLast / dpsFirst, 1 / (dpsSeries.length - 1)) - 1 : null;

  // Return on what was retained (Buffett's test, on owner earnings, no market price needed):
  // the growth in annual owner earnings per dollar of earnings kept in the business.
  const niTotal = per.reduce((a, q) => a + (q.ni || 0), 0);
  const retainedEarnings = niTotal - returned; // net income kept after dividends and buybacks
  const oeFirst = per.find((q) => q.oe != null)?.oe ?? null;
  const oeLast = (endL.cashFromOps != null && endL.capex != null ? endL.cashFromOps - Math.abs(endL.capex) : null) ?? [...per].reverse().find((q) => q.oe != null)?.oe ?? null;
  const incrementalOE = oeFirst != null && oeLast != null ? oeLast - oeFirst : null;
  const returnOnRetained = retainedEarnings > 0 && incrementalOE != null ? incrementalOE / retainedEarnings : null;

  return {
    span: `${years[0]}–${years[years.length - 1]}`,
    cfo, capex, div, bb, returned, retained,
    pReinvest: p(capex), pDiv: p(div), pBB: p(bb), pReturn: p(returned), pRetained: Math.max(0, p(retained)),
    overspent: retained < 0,
    debtChange, cashChange, character,
    // report-card facts
    oeTotal,
    returnedOfOE: oeTotal > 0 ? returned / oeTotal : null,
    avgBuybackPrice, bbSharesPriced, bbSpentPriced,
    firstShares, lastShares, shareChange,
    divYears, dpsFirst, dpsLast, dpsGrowth, everCut,
    retainedEarnings, incrementalOE, returnOnRetained,
  };
}
