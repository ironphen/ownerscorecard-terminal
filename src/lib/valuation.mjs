// Valuation — the other half of Graham: is a good business priced for the buyer
// to make money? Multiples are derived from a market cap (price × shares we
// already pull from EDGAR) over earnings, and shown against the company's own
// ten-year range — never an opinion, just where today sits in its own history.

import { normalizeShares } from "./fundamentals.mjs";

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null;
};
const ownerEarnings = (L) => (L && L.cashFromOps != null && L.capex != null ? L.cashFromOps - Math.abs(L.capex) : null);

export function valuation(company, priceEntry) {
  if (!priceEntry?.current) return null;
  const L = company.lines || {};
  const T = company.ttm?.lines || L; // prefer trailing-twelve-months for the "now" figures
  const shares = L.sharesDiluted;
  if (!shares) return null;
  const mcap = priceEntry.current * shares;

  const oe = ownerEarnings(T);
  const cur = {
    price: priceEntry.current,
    asOf: priceEntry.asOf,
    marketCap: mcap,
    pe: T.netIncome > 0 ? mcap / T.netIncome : null,
    oeYield: oe && oe > 0 ? oe / mcap : null,
    pb: L.stockholdersEquity > 0 ? mcap / L.stockholdersEquity : null,
    divYield: T.dividendsPaid ? Math.abs(T.dividendsPaid) / mcap : null,
  };

  // Historical P/E and owner-earnings yield, shares normalized to today's basis.
  const hist = company.history || [];
  const norm = normalizeShares(hist.map((h) => h.lines.sharesDiluted ?? null));
  const peHist = [], oeyHist = [];
  hist.forEach((h, i) => {
    const p = priceEntry.byYear?.[h.fy];
    const sh = norm[i];
    if (!p || !sh) return;
    const m = p * sh;
    if (h.lines.netIncome > 0) peHist.push(m / h.lines.netIncome);
    const o = ownerEarnings(h.lines);
    if (o && o > 0) oeyHist.push(o / m);
  });
  const range = (arr) => {
    const a = arr.filter((x) => x != null && Number.isFinite(x) && x > 0);
    return a.length >= 4 ? { min: Math.min(...a), max: Math.max(...a), median: median(a) } : null;
  };
  return { cur, peRange: range(peHist), oeyRange: range(oeyHist) };
}

// Where a current value sits in its own range. lowerIsCheap: true for P/E, false
// for yields (a higher yield is cheaper).
export function vsRange(value, range, lowerIsCheap = true) {
  if (value == null || !range) return null;
  const span = range.max - range.min || 1;
  const pctl = Math.max(0, Math.min(1, (value - range.min) / span));
  const cheap = lowerIsCheap ? pctl <= 0.33 : pctl >= 0.66;
  const rich = lowerIsCheap ? pctl >= 0.66 : pctl <= 0.33;
  return {
    pctl,
    tone: cheap ? "good" : rich ? "warn" : "ok",
    label: cheap ? "low end of its 10-yr range" : rich ? "high end of its 10-yr range" : "mid-range vs its own history",
  };
}
