// reverseDcf.mjs — the reverse-DCF core: the pure math that turns a reader-supplied price
// into "what you'd have to believe." It carries no price, no DOM, no company shape; it is
// just the arithmetic, so the company-page valuation (Valuation.astro) and the head-to-head
// compare view can import the SAME functions and can never quietly disagree on what a price
// implies. Importable both at build time (Node, in buildCompareCards.mjs) and in the browser
// (bundled into the page scripts).
//
// A reverse-DCF never produces a price target. It inverts the question: given a price, what
// owner-earnings (or book, or FFO) growth would have to hold for that price to make sense —
// set against what the business has actually delivered. The judgment stays with the reader.

// Present value of an owner-earnings stream that grows at `gr` for `N` years and then `gT`
// forever, discounted at `rr`, expressed as a MULTIPLE of the starting (year-0) owner
// earnings. So pv(0.10, 0.09, 10, 0.025) is "what 10%-for-a-decade-then-2.5% is worth, in
// times-owner-earnings, at a 9% discount."
export function pv(gr, rr, N, gT) {
  let p = 0, oe = 1;
  for (let y = 1; y <= N; y++) { oe *= 1 + gr; p += oe / Math.pow(1 + rr, y); }
  return p + (oe * (1 + gT)) / (rr - gT) / Math.pow(1 + rr, N);
}

// Invert pv by bisection: the growth rate that makes the present-value multiple equal `mult`.
// Returns { g } when the rate lands inside the search band, or pins the dial with { g, floor:true }
// (the price implies decline steeper than −50%/yr) / { g, cap:true } (even 100%/yr can't reach it).
// Returns null when the discount rate isn't above the terminal rate — the model has no solution.
export function solve(mult, rr, N, gT) {
  if (rr <= gT) return null;
  const f = (gr) => pv(gr, rr, N, gT) - mult;
  let lo = -0.5, hi = 1.0;
  if (f(lo) > 0) return { g: lo, floor: true };
  if (f(hi) < 0) return { g: hi, cap: true };
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f(m) > 0) hi = m; else lo = m; }
  return { g: (lo + hi) / 2 };
}

// A bank or insurer is worth a multiple of tangible book set by the return it earns on that
// book: (return − growth) / (cost of equity − growth). A franchise earning exactly its cost of
// equity is worth ~1× tangible book; every point of durable excess return is worth paying up for.
// null when the cost of equity isn't above growth (no finite multiple), floored at zero.
export function justifiedBookMultiple(returnOnEquity, costOfEquity, growth) {
  return costOfEquity > growth ? Math.max(0, (returnOnEquity - growth) / (costOfEquity - growth)) : null;
}

// A Gordon-growth perpetuity multiple, 1 / (discount − growth). It values a REIT on its FFO and,
// in the negative-owner-earnings mode, the mature owner-earnings stream a price demands. null when
// the discount rate isn't above the growth rate.
export function gordonMultiple(discount, growth) {
  return discount > growth ? 1 / (discount - growth) : null;
}
