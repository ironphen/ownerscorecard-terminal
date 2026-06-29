// Capital allocation over the record, Buffett's "most important job of management."
// Where did the cash the business generated actually go, across the whole span, and on
// what terms: back into the business (capex), out to owners (dividends, buybacks at what
// price), or to the balance sheet. Pure arithmetic on figures the pipeline pulls; the
// report lays the facts in a row and never grades, the owner judges.

import { ownerEarningsAbs } from "./fundamentals.mjs";

// Diluted share counts come straight from each filing, and a stock split restates them: the
// years a later 10-K still covers are reported on the new basis, while older years (no later
// filing reaches back to restate them) stay on the old one, leaving a 4x or 20x cliff in the
// raw series. Left uncorrected it reads as enormous dilution (Apple's 5.5B in 2016 beside its
// 15B in 2025) when the count actually fell by a third. This rescales the series across any
// split-sized jump, snapping the jump to the nearest clean split ratio, so the whole series
// sits on the latest year's basis. Organic change (buybacks, stock pay) passes through.
const SPLIT_RATIOS = [1.5, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 25, 30, 40, 50];
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
    const oe = ownerEarningsAbs(L, company);
    return {
      fy: h.fy,
      cfo: L.cashFromOps || 0,
      capex: L.capex != null ? Math.abs(L.capex) : 0,
      div: L.dividendsPaid != null ? Math.abs(L.dividendsPaid) : 0,
      divPresent: L.dividendsPaid != null, // distinguish "reported zero" from "not in the data"
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
  if (p(returned) >= 0.6) character = "a cash returner, paying most of what it earns straight back to owners";
  else if (p(capex) >= 0.5) character = "a reinvestor, most operating cash is plowed back into the business";
  else if (debtChange != null && debtChange < -0.2 * cfo) character = "a deleverager, a meaningful share of cash went to paying down debt";
  else if (cashChange != null && cashChange > 0.25 * cfo) character = "a cash builder, a large share of cash simply built up on the balance sheet";
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

  // Buybacks at what price, on one split-adjusted basis, so the blended average is cash ÷ shares
  // actually bought, stated in today's shares. A close approximation (a year of purchases, any
  // accelerated repurchase), not a tick-by-tick figure. One wrinkle the diluted-share factor alone
  // can't catch: a later 10-K sometimes restates the diluted count for a split while the
  // buyback-share count for the same year was pulled before that restatement, leaving the two on
  // different bases (Netflix's 2025 ten-for-one — the diluted series is post-split from FY2023, but
  // the repurchase counts stayed pre-split through FY2024). A single factor then mis-scales those
  // years and the blend mixes pre- and post-split prices. So we don't only trust the factor: the
  // true today-basis multiple for a year's repurchases is one the record already shows, and we pick
  // — walking back from the most recent buyback, which is reliably on today's basis — whichever
  // keeps the per-share price in line with the year beside it. We let only large, clean split ratios
  // drive this: a 1.5 or 2 in the series is far more often share-count noise (issuance, a merger)
  // than a true split, and shouldn't move a price. If after all that the per-year prices still don't
  // reconcile, the basis is one we can't trust, so we withhold the average rather than publish a guess.
  const REAL_SPLITS = new Set([4, 5, 6, 7, 8, 10, 15, 20, 25, 30, 40, 50]);
  const splitMultiples = [...new Set([...splitFac.values()])].filter((m) => REAL_SPLITS.has(m)).sort((a, b) => a - b);
  const bbYears = per
    .filter((q) => q.bb > 0 && q.repShares != null)
    // A repurchase of more shares than the company has is a mis-tag, not a buyback — drop the
    // year so it cannot poison the blend (the source of the $0.00-per-share artifacts).
    .filter((q) => q.shares == null || q.repShares <= q.shares * 1.05)
    .sort((a, b) => a.fy - b.fy);
  let bbSpentPriced = 0, bbSharesPriced = 0, avgBuybackPrice = null, bbPriceUnreliable = false, keptPriced = [];
  if (bbYears.length) {
    const priced = bbYears.map((q) => ({ fy: q.fy, spent: q.bb, baseShares: q.repShares * fac(q.fy) }));
    const n = priced.length;
    priced[n - 1].shares = priced[n - 1].baseShares; // most recent buyback anchors today's basis
    priced[n - 1].price = priced[n - 1].spent / priced[n - 1].shares;
    for (let i = n - 2; i >= 0; i--) {
      const ref = priced[i + 1].price; // the corrected price of the next-newer buyback year
      const baseShares = priced[i].baseShares;
      const facErr = Math.abs(Math.log((priced[i].spent / baseShares) / ref));
      let shares = baseShares, err = facErr;
      for (const m of splitMultiples) {
        const thresh = Math.log(Math.sqrt(m)); // override only on a discrepancy past half the split
        const altShares = baseShares * m, altErr = Math.abs(Math.log((priced[i].spent / altShares) / ref));
        if (facErr > thresh && altErr < thresh && altErr < err) { shares = altShares; err = altErr; }
      }
      priced[i].shares = shares;
      priced[i].price = priced[i].spent / shares;
    }
    // Only where a real split was in play: if, after correction, adjacent buyback years still differ
    // by more than ~4x, the repurchase counts sit on a basis we couldn't reconcile, so withhold rather
    // than publish a blend we don't trust. (Without a split, a wide spread is just a stock that moved
    // — real, and kept.)
    if (splitMultiples.length) {
      for (let i = 1; i < n; i++) {
        const r = priced[i].price / priced[i - 1].price;
        if (r > 4 || r < 0.25) bbPriceUnreliable = true;
      }
    }
    // Plausibility, split or not: a single year whose reconciled price sits more than ~10× off the
    // median is a mis-tagged repurchase count, not a real price — drop it before the blend. A genuine
    // multi-year price trend stays well inside this; only a tag error blows past it. This catches the
    // $5,482-per-share artifacts the split reconciliation can't see.
    let kept = priced;
    const pl = priced.map((q) => q.price).filter((v) => v > 0).sort((a, b) => a - b);
    const medPrice = pl.length ? pl[Math.floor((pl.length - 1) / 2)] : null;
    if (medPrice) kept = priced.filter((q) => q.price > 0 && q.price <= medPrice * 10 && q.price >= medPrice / 10);
    keptPriced = kept; // the per-year split-corrected prices, surfaced only when the blended average survives
    if (!bbPriceUnreliable && kept.length) {
      bbSpentPriced = kept.reduce((a, q) => a + q.spent, 0);
      bbSharesPriced = kept.reduce((a, q) => a + q.shares, 0);
      avgBuybackPrice = bbSharesPriced > 0 ? bbSpentPriced / bbSharesPriced : null;
    }
    // A sub-dollar blended price is implausible for this large-cap universe: the repurchase count is
    // garbage, so withhold rather than publish "$0.00".
    if (avgBuybackPrice != null && avgBuybackPrice < 1) { avgBuybackPrice = null; bbPriceUnreliable = true; }
  }

  // Did the diluted share count actually fall? The real test, net of stock issued to staff,
  // on the split-adjusted basis above so a split can't masquerade as dilution (or hide it).
  const firstShareYear = per.find((q) => q.shares != null);
  const lastShareYear = [...per].reverse().find((q) => q.shares != null);
  const firstShares = firstShareYear ? firstShareYear.shares * fac(firstShareYear.fy) : null;
  const lastShares = endShares != null ? endShares : (lastShareYear ? lastShareYear.shares * fac(lastShareYear.fy) : null);
  const shareChange = firstShares != null && lastShares != null && firstShares > 0 ? lastShares / firstShares - 1 : null;

  // Final cross-check on the buyback price: the shares we priced should roughly reconcile with the
  // real reduction in the count. If the count genuinely fell but the priced repurchase shares are a
  // small fraction of that drop, the repurchase counts are undercaptured and the blended price is
  // inflated — withhold it. (Catches the uniformly-scaled garbage the per-year checks above miss.)
  if (avgBuybackPrice != null && firstShares != null && lastShares != null) {
    const netReduction = firstShares - lastShares;
    if (netReduction > 0 && bbSharesPriced < netReduction * 0.3) { avgBuybackPrice = null; bbPriceUnreliable = true; }
  }

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
  // the growth in annual owner earnings per dollar of earnings kept in the business. Both
  // endpoints are averaged over the first and last three years (mirroring the leverage check),
  // and both are fiscal-year figures — never a TTM end spliced onto a fiscal-year start — so a
  // single noisy year (a working-capital swing, a soft TTM window) cannot drive the answer to
  // zero or flip its sign.
  const niTotal = per.reduce((a, q) => a + (q.ni || 0), 0);
  const retainedEarnings = niTotal - returned; // net income kept after dividends and buybacks
  const oeVals = per.map((q) => q.oe).filter((v) => v != null);
  const oeEarly = oeVals.length ? oeVals.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, oeVals.length) : null;
  const oeRecent = oeVals.length ? oeVals.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, oeVals.length) : null;
  const incrementalOE = oeVals.length >= 2 && oeEarly != null && oeRecent != null ? oeRecent - oeEarly : null;
  // Only when the company retained a meaningful share of its earnings (at least ~10% of
  // cumulative net income). A near-zero retained base explodes the ratio into a meaningless
  // triple-digit figure for a business that returns almost everything it earns.
  const returnOnRetained = retainedEarnings > Math.abs(niTotal) * 0.1 && incrementalOE != null ? incrementalOE / retainedEarnings : null;

  return {
    span: `${years[0]}–${years[years.length - 1]}`,
    cfo, capex, div, bb, returned, retained,
    pReinvest: p(capex), pDiv: p(div), pBB: p(bb), pReturn: p(returned), pRetained: Math.max(0, p(retained)),
    overspent: retained < 0,
    debtChange, cashChange, character,
    debtStart: H[0].lines.totalDebt ?? null, debtEnd: endL.totalDebt ?? null,
    // report-card facts
    oeTotal,
    returnedOfOE: oeTotal > 0 ? returned / oeTotal : null,
    avgBuybackPrice, bbSharesPriced, bbSpentPriced, bbPriceUnreliable,
    // The per-year price paid, only when the blended average survived every reliability gate — so the
    // year-to-year range and the heaviest-buyback year (did it buy most at the top?) can be read off.
    bbYearly: avgBuybackPrice != null && keptPriced.length ? keptPriced.map((q) => ({ fy: Math.round(q.fy), price: q.price, spent: q.spent })).sort((a, b) => a.fy - b.fy) : null,
    firstShares, lastShares, shareChange,
    divYears, dpsFirst, dpsLast, dpsGrowth, everCut,
    divReported: per.some((q) => q.divPresent), // was a dividend line present at all in the span?
    retainedEarnings, incrementalOE, returnOnRetained,
  };
}
