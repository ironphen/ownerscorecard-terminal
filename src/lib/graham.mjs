// Graham's defensive-investor tests (The Intelligent Investor, ch. 14), run
// mechanically on the filings. We present his framework, not our verdict: meeting
// the tests is a floor of safety, not a buy signal, and failing one is not a veto —
// many fine modern businesses fail his strictest liquidity tests by design. Every
// number is sourced and findable in the record. Modernized thresholds are flagged.

import { fmtUSD } from "./fundamentals.mjs";

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function grahamTests(company) {
  const L = company.lines || {};
  const H = (company.history || []).filter((h) => h?.lines);
  const t = [];
  const add = (name, criterion, value, status, note) => t.push({ name, criterion, value, status, note });

  // 1 — Adequate size
  if (L.revenue != null) {
    const r = L.revenue;
    add("Adequate size", "Revenue ≥ $2B", fmtUSD(r), r >= 2e9 ? "pass" : r >= 1e9 ? "near" : "fail",
      "Big enough to weather a storm. Graham's 1972 floor was ~$100M of sales (≈ $700M today); we use a $2B revenue line as a conservative modern stand-in.");
  }

  // 2 — Strong current ratio
  const ca = L.currentAssets, cl = L.currentLiabilities;
  if (ca != null && cl != null && cl > 0) {
    const cr = ca / cl;
    add("Strong liquidity", "Current ratio ≥ 2×", `${cr.toFixed(2)}×`, cr >= 2 ? "pass" : cr >= 1.5 ? "near" : "fail",
      "Current assets at least twice current liabilities — near-term bills covered without touching the business. Strict by design: many cash-rich modern firms run leaner and miss it, holding their cushion in longer-dated securities.");
  } else {
    add("Strong liquidity", "Current ratio ≥ 2×", "—", "na", "Current assets / liabilities not in the data yet.");
  }

  // 3 — Conservative debt: total debt ≤ working capital (Graham's industrial test, using total debt as the stricter proxy for long-term debt)
  if (ca != null && cl != null && L.totalDebt != null) {
    const wc = ca - cl;
    add("Conservative debt", "Debt ≤ working capital", `${fmtUSD(L.totalDebt)} vs ${fmtUSD(wc)} WC`,
      wc > 0 && L.totalDebt <= wc ? "pass" : wc > 0 && L.totalDebt <= 1.5 * wc ? "near" : "fail",
      "Graham's rule that borrowings not exceed net current assets. Capital-heavy and buyback-heavy firms routinely fail it — read it next to interest coverage, not alone.");
  }

  // 4 — Earnings stability: a profit every year on record
  const ni = H.map((h) => h.lines.netIncome).filter((v) => v != null);
  if (ni.length >= 5) {
    const losses = ni.filter((v) => v <= 0).length;
    add("Earnings stability", `A profit every year (${ni.length}-yr record)`, losses === 0 ? "no losses" : `${losses} loss year${losses > 1 ? "s" : ""}`,
      losses === 0 ? "pass" : losses === 1 ? "near" : "fail",
      "Graham wanted earnings in each of the past ten years — the stability a defensive owner leans on.");
  }

  // 5 — Dividend record. Count over the FULL window: a year with no dividend is a
  // break in the record, not a row to drop (or a COVID suspension reads as "paid every year").
  const total = H.length;
  if (total >= 5) {
    const paid = H.filter((h) => h.lines.dividendsPaid != null && Math.abs(h.lines.dividendsPaid) > 0).length;
    add("Dividend record", "Uninterrupted dividends", paid === total ? `paid every year (${total})` : paid === 0 ? "none paid" : `${paid} of ${total} yrs`,
      paid === total ? "pass" : paid === 0 ? "fail" : paid >= total * 0.9 ? "near" : "fail",
      "An unbroken dividend was Graham's mark of durability. He wanted twenty years; the filings show about ten, and a single suspension breaks the streak. Non-payers — many fine modern compounders — fall outside his defensive net by design.");
  }

  // 6 — Earnings growth: net income up ≥ 33% over the record (3-yr averages, to smooth).
  // Total net income, not per-share — avoids stock-split artifacts; dilution is tracked separately.
  if (ni.length >= 6) {
    const early = mean(ni.slice(0, 3)), late = mean(ni.slice(-3));
    if (early > 0) {
      const g = (late - early) / early;
      add("Earnings growth", "Earnings +33% over the record", `${g >= 0 ? "+" : "−"}${Math.abs(g * 100).toFixed(0)}%`,
        g >= 0.33 ? "pass" : g > 0 ? "near" : "fail",
        "At least a third more earnings than a decade ago, averaging three years at each end. Net income (not per-share), so stock splits don't distort it — buybacks and dilution show up in the share-count line instead.");
    } else {
      add("Earnings growth", "Earnings +33% over the record", "—", "na", "Earnings were negative early in the record — a growth rate isn't meaningful.");
    }
  }

  // 7 — Moderate price (price-dependent → the reader-supplied calculator)
  const eps = L.netIncome != null && L.sharesDiluted ? L.netIncome / L.sharesDiluted : null;
  const bvps = L.stockholdersEquity != null && L.sharesDiluted ? L.stockholdersEquity / L.sharesDiluted : null;
  add("Moderate price", "P/E ≤ 15 and P/E × P/B ≤ 22.5", "decided by the price", "na",
    `Graham's valuation gate — the wall he kept between a sound business and a sound investment. ${eps ? `Earnings are $${eps.toFixed(2)}/share` : ""}${eps && bvps ? " and " : ""}${bvps ? `book value $${bvps.toFixed(2)}/share` : ""}. Enter a price in “What the price implies” just below for the P/E, P/B, and whether it clears. But this is the rule Buffett outgrew: there's no hard P/E law, and a wonderful business can deserve a far richer multiple if the thesis holds — treat it as the bargain-hunter's floor, not a verdict on the price.`);

  const runnable = t.filter((x) => x.status !== "na");
  const passes = t.filter((x) => x.status === "pass").length;
  return { tests: t, passes, testable: runnable.length };
}
