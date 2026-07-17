// ownerStatement.mjs — the look-through arithmetic behind /owner: the reader's shares as a
// fraction of the company, and that fraction applied to the company's own filed figures.
// Buffett's 1991 instruction, verbatim license: "We also believe that investors can benefit
// by focusing on their own look-through earnings. To calculate these, they should determine
// the underlying earnings attributable to the shares they hold in their portfolio and total
// these." (The first shipped epigraph paraphrased this inside quotation marks; the partner
// pass caught it. Quotations are verbatim or they are not quotations.)
//
// Pure — no DOM, no fetch — so scripts/ownerTest.mjs proves the arithmetic. Doctrine: every
// number here is either the reader's input (shares, an optional dated price) or an as-filed
// figure times the reader's own fraction. Nothing is estimated, nothing is graded, nothing
// is ranked. A figure a filing doesn't carry stays a dash; totals say how many rows they
// cover rather than pretending completeness.

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Money in the register the site uses: $1.29B, ¥2,341B, $412M, −$63.9B (sign before symbol).
export function money(v, sym = "$") {
  if (v == null || !Number.isFinite(v)) return "—";
  const neg = v < 0;
  const a = Math.abs(v);
  const f = (n, u) => `${neg ? "−" : ""}${sym}${n}${u}`;
  if (a >= 1e12) return f((a / 1e12).toFixed(2), "T");
  if (a >= 1e9) return f((a / 1e9).toFixed(2), "B");
  if (a >= 1e6) return f((a / 1e6).toFixed(1), "M");
  if (a >= 1e3) return f(Math.round(a / 1e3).toLocaleString("en-US"), "K");
  return f(a.toFixed(0), "");
}

// The fraction, said the way an owner would say it: "1/29,374,712th of the company", and as
// a percentage when it is large enough to read as one.
export function fractionLabel(frac) {
  if (frac == null || !(frac > 0)) return "—";
  if (frac >= 1) return "the whole company, or more than the filed share count";
  if (frac >= 0.0001) return `${(frac * 100).toFixed(frac >= 0.01 ? 1 : 3)}% of the company`;
  return `1/${Math.round(1 / frac).toLocaleString("en-US")}th of the company`;
}

// One holding: the reader's share count against a compare-card's as-filed figures.
// card: the /compare/{ticker}.json shape (price block + quality + name/fy/form at the top).
// Returns null when the card can't support the arithmetic (no filed share count).
export function holdingRow(card, sharesOwned) {
  const shares = num(card?.price?.shares);
  const owned = num(sharesOwned);
  if (!shares || shares <= 0 || !owned || owned <= 0) return null;
  const frac = owned / shares;
  const p = card.price;
  const q = card.quality || {};
  const isBank = p.mode === "bank";
  // The return each business earns, in the lens its economics call for: a bank on its
  // normalized return on tangible equity, everything else on through-cycle median ROIC
  // (falling back to through-cycle ROE where invested capital can't be read). The label
  // carries the figure's own span (a median travels with its period; a bank's ROTCE is
  // normalized, not a period median — never invent a span the card doesn't state).
  const ret = isBank
    ? (num(q.rotce) != null ? { label: "ROTCE", note: "normalized", v: q.rotce } : null)
    : num(q.roicThroughCycle?.median) != null
      ? { label: "ROIC", note: num(q.roicThroughCycle.n) ? `${q.roicThroughCycle.n}-yr median` : "median", v: q.roicThroughCycle.median }
      : num(q.roeThroughCycle?.median) != null
        ? { label: "ROE", note: num(q.roeThroughCycle.n) ? `${q.roeThroughCycle.n}-yr median` : "median", v: q.roeThroughCycle.median }
        : null;
  // Delivered per-share growth over the filed record — the second lever of Buffett's decade
  // goal beside the return. Owner earnings per share where the record carries it; EPS as the
  // labeled fallback. A compound rate of filed figures, never a projection.
  const g = card.compounding?.perShare || {};
  const grow = num(g.ownerEarningsPS?.full) != null
    ? { label: "OE/sh", v: g.ownerEarningsPS.full }
    : num(g.eps?.full) != null
      ? { label: "EPS", v: g.eps.full }
      : null;
  // What the record's share count did to this same stake: the then-fraction on today's
  // split-adjusted basis. The filed starting count (stewardship.firstShares) when the card
  // carries it; the split-normalized record change as the approximate fallback for older
  // cards. The page's foot names the computation either way.
  const fs = num(card.stewardship?.firstShares);
  const sc = num(card.stewardship?.shareChange);
  const thenFrac = card.stewardship?.buybackSpan
    ? fs != null && fs > 0
      ? { frac: owned / fs, span: card.stewardship.buybackSpan }
      : sc != null && sc > -1
        ? { frac: owned / (shares / (1 + sc)), span: card.stewardship.buybackSpan }
        : null
    : null;
  return {
    ticker: card.ticker,
    name: card.name || card.ticker,
    ccy: p.currency || "USD",
    sym: p.sym || "$",
    fy: card.fy ?? null,
    form: card.form ?? null,
    owned,
    frac,
    rev: num(p.rev) != null ? p.rev * frac : null,
    oe: num(p.oe) != null ? p.oe * frac : null,
    // The three-year average of filed owner earnings — Graham's earning-power caution
    // beside the single year (totals only; the label carries the span).
    oe3: num(p.oe3) != null ? p.oe3 * frac : null,
    ni: num(p.ni) != null ? p.ni * frac : null,
    // The 1991 split's paid-out half: the year's dividends paid times the reader's fraction.
    // An attribution on the filed year, never "cash you received" (a mid-year buyer did not
    // receive it). A filed zero is a fact (the retained half is then the whole profit); an
    // absent tag stays null and no split renders.
    div: num(p.div) != null ? p.div * frac : null,
    netDebt: num(p.netDebt) != null ? p.netDebt * frac : null,
    // Book value per share times the reader's shares IS the reader's share of equity —
    // the denominator the look-through return on equity needs.
    bv: num(p.bvps) != null ? p.bvps * owned : null,
    ret,
    grow,
    thenFrac,
  };
}

// Per-currency totals. Each figure sums the rows that carry it and reports its coverage;
// the outlay and the owner-earnings yield exist only over rows the reader priced, and only
// where the owner-earnings figure exists beside the price (never a yield on a mixed base).
// The look-through return on equity is the reader's profit over the reader's equity, summed
// only across rows carrying BOTH — a ratio never mixes rows its own numerator doesn't cover.
export function statementTotals(rows, prices = {}) {
  const byCcy = new Map();
  for (const r of rows) {
    if (!r) continue;
    const t = byCcy.get(r.ccy) ?? {
      ccy: r.ccy, sym: r.sym, n: 0,
      rev: 0, revN: 0, oe: 0, oeN: 0, oe3: 0, oe3N: 0, ni: 0, niN: 0, netDebt: 0, netDebtN: 0, bv: 0, bvN: 0,
      splitNi: 0, splitDiv: 0, splitN: 0,
      roeNi: 0, roeBv: 0, roeN: 0,
      outlay: 0, oeOnOutlay: 0, pricedN: 0,
    };
    t.n++;
    if (r.rev != null) { t.rev += r.rev; t.revN++; }
    if (r.oe != null) { t.oe += r.oe; t.oeN++; }
    if (r.oe3 != null) { t.oe3 += r.oe3; t.oe3N++; }
    if (r.ni != null) { t.ni += r.ni; t.niN++; }
    // The paid-out/retained split sums only rows carrying BOTH the profit and the dividend
    // line — a split whose halves cover different rows would not add back to its whole.
    if (r.ni != null && r.div != null) { t.splitNi += r.ni; t.splitDiv += r.div; t.splitN++; }
    if (r.netDebt != null) { t.netDebt += r.netDebt; t.netDebtN++; }
    if (r.bv != null) { t.bv += r.bv; t.bvN++; }
    if (r.ni != null && r.bv != null && r.bv > 0) { t.roeNi += r.ni; t.roeBv += r.bv; t.roeN++; }
    const px = num(prices[r.ticker]);
    if (px != null && px > 0 && r.oe != null) {
      t.outlay += px * r.owned;
      t.oeOnOutlay += r.oe;
      t.pricedN++;
    }
    byCcy.set(r.ccy, t);
  }
  return [...byCcy.values()].map((t) => ({
    ...t,
    oeYield: t.outlay > 0 ? t.oeOnOutlay / t.outlay : null,
    lookRoe: t.roeBv > 0 ? t.roeNi / t.roeBv : null,
  }));
}

// The combined statement, in dollars, at DATED reference rates — never live quotes. fx maps
// currency → USD per unit (rates.json's table, dated fxAsOf); a group whose rate is missing
// is left out and NAMED in `skipped` rather than silently dropped. Ratios recombine from
// their converted parts, so the combined yield and return cover exactly the rows their
// per-currency parts covered.
export function combineUsd(groups, fx = {}) {
  const c = {
    sym: "$", n: 0,
    rev: 0, revN: 0, oe: 0, oeN: 0, oe3: 0, oe3N: 0, ni: 0, niN: 0, netDebt: 0, netDebtN: 0, bv: 0, bvN: 0,
    splitNi: 0, splitDiv: 0, splitN: 0,
    roeNi: 0, roeBv: 0, roeN: 0,
    outlay: 0, oeOnOutlay: 0, pricedN: 0,
    rates: [], skipped: [],
  };
  for (const g of groups) {
    const f = g.ccy === "USD" ? 1 : num(fx[g.ccy]);
    if (f == null || f <= 0) { c.skipped.push(g.ccy); continue; }
    if (g.ccy !== "USD") c.rates.push({ ccy: g.ccy, sym: g.sym, usdPerUnit: f });
    c.n += g.n;
    c.rev += g.rev * f; c.revN += g.revN;
    c.oe += g.oe * f; c.oeN += g.oeN;
    c.oe3 += g.oe3 * f; c.oe3N += g.oe3N;
    c.ni += g.ni * f; c.niN += g.niN;
    c.splitNi += g.splitNi * f; c.splitDiv += g.splitDiv * f; c.splitN += g.splitN;
    c.netDebt += g.netDebt * f; c.netDebtN += g.netDebtN;
    c.bv += g.bv * f; c.bvN += g.bvN;
    c.roeNi += g.roeNi * f; c.roeBv += g.roeBv * f; c.roeN += g.roeN;
    c.outlay += g.outlay * f; c.oeOnOutlay += g.oeOnOutlay * f; c.pricedN += g.pricedN;
  }
  c.oeYield = c.outlay > 0 ? c.oeOnOutlay / c.outlay : null;
  c.lookRoe = c.roeBv > 0 ? c.roeNi / c.roeBv : null;
  return c;
}
