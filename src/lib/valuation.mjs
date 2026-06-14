// Reverse-DCF — the honest use of a price.
//
// We never print a "fair value" or a buy/sell. We solve the inverse question:
// at today's close, what owner-earnings growth is the market *implicitly* pricing?
// Then we set that number next to what the company has actually done. This is
// Buffett's Aesop, made literal — how many birds, on what schedule, discounted at
// what rate — so a reader can see the assumption baked into the price instead of
// pretending the number fell from the sky.

import { liquidAssets } from "./fundamentals.mjs";

// Present value of $1 of current owner earnings growing at g for N years, then a
// Gordon terminal growing at gT, all discounted at r. Monotonic increasing in g.
export function pvPerDollar(g, r, N, gT) {
  let pv = 0, oe = 1;
  for (let y = 1; y <= N; y++) { oe *= 1 + g; pv += oe / Math.pow(1 + r, y); }
  const terminal = (oe * (1 + gT)) / (r - gT);
  return pv + terminal / Math.pow(1 + r, N);
}

// Solve for the growth rate g that makes the discounted stream equal the price
// (i.e. pvPerDollar(g) === marketCap / ownerEarnings). Bisection — robust, no calculus.
export function impliedGrowth({ marketCap, ownerEarnings, r = 0.09, N = 10, gT = 0.025 }) {
  if (!(ownerEarnings > 0) || !(marketCap > 0) || r <= gT) return null;
  const target = marketCap / ownerEarnings;
  const f = (g) => pvPerDollar(g, r, N, gT) - target;
  let lo = -0.5, hi = 1.0;
  if (f(lo) > 0) return { g: lo, floor: true }; // even a 50%/yr decline can't get the value this low → price is extraordinarily cheap vs. cash flow
  if (f(hi) < 0) return { g: hi, cap: true };    // even 100%/yr growth can't justify the price
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) hi = mid; else lo = mid; }
  return { g: (lo + hi) / 2 };
}

// Assemble everything the page needs for one company at one price.
export function expectations(company, price, opts = {}) {
  const L = company.ttm?.lines || company.lines || {};
  const shares = L.sharesDiluted;
  const cfo = L.cashFromOps, capex = L.capex;
  if (!price || !shares || cfo == null || capex == null) return null;

  const ownerEarnings = cfo - Math.abs(capex);
  const marketCap = price * shares;
  const netDebt = (L.totalDebt || 0) - (liquidAssets(L) || 0);
  const r = opts.r ?? 0.09, N = opts.N ?? 10, gT = opts.gT ?? 0.025;
  const res = ownerEarnings > 0 ? impliedGrowth({ marketCap, ownerEarnings, r, N, gT }) : null;

  return {
    price, shares, marketCap, ownerEarnings, netDebt,
    oeYield: ownerEarnings > 0 ? ownerEarnings / marketCap : null, // owner-earnings yield = the "bird in hand" rate
    r, N, gT,
    impliedG: res?.g ?? null,
    capped: res?.cap || false,
    floored: res?.floor || false,
    runnable: ownerEarnings > 0,
  };
}
