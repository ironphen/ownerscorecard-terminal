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
// 15B in 2025) when the count actually fell by a third. But a split-sized jump is not always a
// split: a merger paid in stock, an IPO, a big offering all put real new shares out, and calling
// those a split fabricates the per-share record (Realty Income's VEREIT year, Takeda's Shire
// year, Airbnb's IPO). So a jump is rescaled only when the totals corroborate a split — a true
// split restates the share count and nothing else, so revenue, dividends paid and assets are
// unchanged and their per-share values drop by exactly the split ratio; a merger or an offering
// scales the totals roughly with the count, so per-share values stay continuous as filed.
const SPLIT_RATIOS = [1.5, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 25, 30, 40, 50];
const SPLIT_MARGIN = Math.log(1.15); // the split reading must beat "no split" by this much continuity
const SNAP_WEIGHT = 3.5; // how hard the implied organic share residual counts against a candidate ratio
// The corroboration test at one boundary (a → b, consecutive share observations whose ratio is
// split-sized). Candidates are the clean ratios whose implied organic share change stays inside
// what a split year plausibly does to the count on its own. Each candidate
// is scored on per-share continuity, in log space, across the measures a split cannot move: the
// flows first (revenue — ignored where it is a mis-tagged sliver of assets — and dividends paid),
// with total assets as supporting evidence only, since balance-sheet timing around a mid-year
// merger can mimic a split; no flow measure, no split call — the record stays as filed. The
// residual organic share move a candidate implies is weighed against it (a 20-for-1 with 1% of
// buybacks beats a 15-for-1 with 35% of phantom issuance). The winner must read decisively more
// continuous than "no split", and must not imply an implausible collapse in per-share revenue —
// a company issuing into a shrinking business is not splitting its stock. Two shapes the totals
// alone cannot settle get their own rules. An IPO converts preferred into common that was
// economically there all along, so per-share totals run continuous through the share-count jump
// exactly as a split would (Uber's 2019 reads perfectly continuous at 2×) — continuity cannot
// tell them apart, and what does is the residual: a real split's boundary year moves the count
// organically like any other year (buybacks down to ~−12%, issuance rarely past a few percent),
// while an IPO's jump lands loosely above a clean ratio. So candidates are scored across a wide
// residual band — the truest explanation must win the contest, or a neighboring clean ratio
// masquerades (Tesla's FY2020 is 3 × 22% of real issuance, and with 3 barred a phantom 4 would
// read as a 9% buyback Tesla never did) — but the winner is accepted only when its residual sits
// in [−12%, +5%] (stretched to +10% when revenue, dividends and assets all three corroborate
// decisively — Sempra's 2-for-1 carries 7% of real issuance on top, Pathward's 3-for-1 nearly
// 10% — the dividend's own continuity is what earns the stretch); and a jump on the heels of
// another split-sized jump is never a split — restatement boundaries sit alone, while an IPO's
// conversion jump is followed by a full-year catch-up jump (Uber's 2020) and a serial issuer
// jumps in runs. The cost is deliberate: a split stacked on heavy same-year issuance (Tesla's
// FY2020) stays as filed with a note, because rescaling it would also rescale every IPO.
// And a fast grower's organic totals move as much as a small split would (Old Dominion's 3-for-2
// inside a +20% year), leaving continuity a tie — there, only when the raw jump lands within ~5%
// of a clean ratio AND the company's count is otherwise nearly still (median move ≤5% a year and
// no year past 15% — a serial issuer never qualifies) does the split reading win the tie.
// Returns the clean multiple to apply, or 1: never the raw ratio, so real buybacks or issuance
// in a split year pass through instead of being scaled away (Apple's FY2018 buyback).
const STILL = Math.log(1.05);
function corroboratedSplit(a, b, stillness) {
  const r = b.shares / a.shares;
  const inBand = (c) => r / c >= 0.88 && r / c <= 1.4; // the contest band; acceptance is stricter below
  const cands = r > 1
    ? SPLIT_RATIOS.filter(inBand)
    : SPLIT_RATIOS.map((s) => 1 / s).filter(inBand);
  if (!cands.length) return 1;
  const revOk = (p) => p.revenue > 0 && !(p.totalAssets > 0 && p.revenue < p.totalAssets * 0.02);
  const flows = [revOk(a) && revOk(b) ? "revenue" : null, a.dividendsPaid && b.dividendsPaid ? "dividendsPaid" : null].filter(Boolean);
  if (!flows.length) return 1; // nothing timing-consistent to corroborate against — as filed
  const measures = [...flows, ...(a.totalAssets > 0 && b.totalAssets > 0 ? ["totalAssets"] : [])];
  const perShareRatio = (k) => (Math.abs(b[k]) / b.shares) / (Math.abs(a[k]) / a.shares);
  const err = (c) => measures.reduce((e, k) => e + Math.abs(Math.log(perShareRatio(k) * c)), 0);
  const none = err(1);
  let best = 1, bestScore = Infinity;
  for (const c of cands) {
    const score = err(c) + SNAP_WEIGHT * Math.abs(Math.log(r / c));
    if (score < bestScore) { best = c; bestScore = score; }
  }
  if (best === 1) return 1;
  const decisive = err(best) <= none - SPLIT_MARGIN;
  const fully = measures.length === 3 && decisive; // every measure in the record corroborates
  if (r / best < 0.88 || r / best > (fully ? 1.1 : 1.05)) return 1; // the residual reads as an IPO or issuance, not a split year
  const tied = err(best) <= none + SPLIT_MARGIN && Math.abs(Math.log(r / best)) <= STILL && stillness;
  if (!decisive && !tied) return 1;
  if (flows.includes("revenue")) {
    const organic = perShareRatio("revenue") * best; // per-share revenue move the split reading implies
    if (organic < 0.72 || organic > 2.2) return 1;
  }
  return best;
}
// Per-year split factor: walk the diluted-share series and carry the cumulative multiple that
// puts each earlier year onto the latest year's basis. Each point carries its share count plus
// whatever totals the year has (revenue, dividendsPaid, totalAssets) for the corroboration test.
// Returned as a Map keyed by fiscal year, so one factor serves every per-share quantity the
// section uses, the share count, the shares repurchased, and the dividend per share, and a
// split distorts none of them.
export function splitFactorsByFy(points) {
  const pts = points.filter((p) => p.shares != null && p.shares > 0);
  const m = new Map();
  if (!pts.length) return m;
  // How much the count moves in an ordinary year here, across the boundaries that aren't
  // split-sized. Feeds the tie-break above — true for a company that neither issues nor retires
  // much (median move ≤5%, no year past 15%), false for a serial issuer.
  const moves = pts.slice(1)
    .map((p, i) => Math.abs(Math.log(p.shares / pts[i].shares)))
    .filter((v) => v < Math.log(1.4))
    .sort((x, y) => x - y);
  const stillness = moves.length >= 2
    && moves[Math.floor((moves.length - 1) / 2)] <= STILL
    && moves[moves.length - 1] <= Math.log(1.15);
  const jump = (i) => pts[i + 1].shares / pts[i].shares >= 1.4 || pts[i + 1].shares / pts[i].shares <= 1 / 1.4;
  let factor = 1;
  m.set(pts[pts.length - 1].fy, 1);
  for (let i = pts.length - 2; i >= 0; i--) {
    if (jump(i)) factor *= i >= 1 && jump(i - 1) ? 1 : corroboratedSplit(pts[i], pts[i + 1], stillness);
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
  // Funds an owner watches being drawn down are cash PLUS the short-term portfolio — a company
  // "spends" by selling T-bills as readily as by letting the bank line fall, and the two slosh
  // into each other (Apple's cash rose while its short-term investments fell). The long-term
  // marketable portfolio is tracked separately: it is the piece Apple actually sold down to fund
  // returns beyond operating cash, and the funding note names it when the residual points there.
  const liquid = (L) => (L.cashAndEquivalents != null ? L.cashAndEquivalents + (L.shortTermInvestments || 0) : null);
  const cashChange = liquid(H[0].lines) != null && liquid(endL) != null ? liquid(endL) - liquid(H[0].lines) : null;
  const ltInvestChange = H[0].lines.longTermMarketable != null && endL.longTermMarketable != null ? endL.longTermMarketable - H[0].lines.longTermMarketable : null;

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
  // Factors come from the FULL share history, not the capex-filtered window above: the window can
  // start right at a split's restatement boundary (NVIDIA's capital span opens on its 10-for-1),
  // where a truncated series can't tell a restatement from a record that begins at a jump.
  const endShares = endL.sharesDiluted && endL.sharesDiluted > 0 ? endL.sharesDiluted : null;
  const sharePoints = (company.history || []).filter((h) => h?.lines?.sharesDiluted > 0)
    .map((h) => ({ fy: h.fy, shares: h.lines.sharesDiluted, revenue: h.lines.revenue, dividendsPaid: h.lines.dividendsPaid, totalAssets: h.lines.totalAssets }));
  const lastHistFy = sharePoints.length ? sharePoints[sharePoints.length - 1].fy : 0;
  if (endShares != null && (!sharePoints.length || endShares !== sharePoints[sharePoints.length - 1].shares))
    sharePoints.push({ fy: lastHistFy + 0.5, shares: endShares, revenue: endL.revenue, dividendsPaid: endL.dividendsPaid, totalAssets: endL.totalAssets });
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
  const dpsPts = per.filter((q) => q.dps != null).map((q) => ({ dps: q.dps / fac(q.fy), tot: q.div }));
  const dpsSeries = dpsPts.map((p) => p.dps);
  const dpsFirst = dpsSeries.length ? dpsSeries[0] : null;
  const dpsLast = dpsSeries.length ? dpsSeries[dpsSeries.length - 1] : null;
  // The per-share dividend here is a proxy — the total paid over the average diluted count — and a
  // one-year wobble in it is usually the proxy, not the dividend: a mid-year issuance swells the
  // denominator before the payout catches up (Takeda's Shire year), preferred run-off or payment
  // timing nudges the total (Danaher, whose common dividend rose every year of the record), and
  // the count itself drifts a few percent (Virtu's flat $0.96 reads ±4%). So a dip past the proxy's
  // ~4% noise band reads as a cut only when it persists into the next year, or when it is deep
  // (past ~10%) and the total actually paid fell with it — never from a one-year wobble that recovers.
  let everCut = false;
  for (let i = 1; i < dpsPts.length; i++) {
    if (dpsPts[i].dps >= dpsPts[i - 1].dps * 0.96) continue; // inside the proxy's noise, not a dip
    const persists = i + 1 < dpsPts.length && dpsPts[i + 1].dps < dpsPts[i - 1].dps * 0.96;
    const deep = dpsPts[i].dps < dpsPts[i - 1].dps * 0.9 && dpsPts[i].tot < dpsPts[i - 1].tot * 0.98;
    if (persists || deep) everCut = true;
  }
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
    debtChange, cashChange, ltInvestChange, character,
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
