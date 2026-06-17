// Capital allocation over the record, Buffett's "most important job of management."
// Where did the cash the business generated actually go, across the whole span, and on
// what terms: back into the business (capex), out to owners (dividends, buybacks at what
// price), or to the balance sheet. Pure arithmetic on figures the pipeline pulls; the
// report lays the facts in a row and never grades, the owner judges.

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

  // Buybacks at what price: align cash with count, summing only the years that report both,
  // so the blended average is cash ÷ shares actually bought. A close approximation (a year of
  // purchases, any accelerated repurchase), not a tick-by-tick figure.
  const bbYears = per.filter((q) => q.bb > 0 && q.repShares != null);
  const bbSpentPriced = bbYears.reduce((a, q) => a + q.bb, 0);
  const bbSharesPriced = bbYears.reduce((a, q) => a + q.repShares, 0);
  const avgBuybackPrice = bbSharesPriced > 0 ? bbSpentPriced / bbSharesPriced : null;

  // Did the diluted share count actually fall? The real test, net of stock issued to staff.
  const firstShares = per.find((q) => q.shares != null)?.shares ?? null;
  const lastShares = (endL.sharesDiluted && endL.sharesDiluted > 0 ? endL.sharesDiluted : null) ?? [...per].reverse().find((q) => q.shares != null)?.shares ?? null;
  const shareChange = firstShares != null && lastShares != null ? lastShares / firstShares - 1 : null;

  // Dividend record: years paid, the trajectory of the per-share dividend, and whether it
  // was ever cut (the fact a dividend investor cares about most).
  const dpsSeries = per.map((q) => q.dps).filter((v) => v != null);
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
