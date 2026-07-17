// ownerStatement.mjs — the look-through arithmetic behind /owner: the reader's shares as a
// fraction of the company, and that fraction applied to the company's own filed figures.
// Buffett's 1991 instruction, verbatim license: "calculate the underlying earnings
// attributable to the shares you hold in your portfolio and total these."
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
  if (frac >= 1) return "the whole company (check the share count)";
  if (frac >= 0.0001) return `${(frac * 100).toFixed(frac >= 0.01 ? 1 : 3)}% of the company`;
  return `1/${Math.round(1 / frac).toLocaleString("en-US")}th of the company`;
}

// One holding: the reader's share count against a compare-card's as-filed figures.
// card: the /compare/{ticker}.json shape (price block + name/fy/form at the top level).
// Returns null when the card can't support the arithmetic (no filed share count).
export function holdingRow(card, sharesOwned) {
  const shares = num(card?.price?.shares);
  const owned = num(sharesOwned);
  if (!shares || shares <= 0 || !owned || owned <= 0) return null;
  const frac = owned / shares;
  const p = card.price;
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
    ni: num(p.ni) != null ? p.ni * frac : null,
    netDebt: num(p.netDebt) != null ? p.netDebt * frac : null,
  };
}

// Per-currency totals. Each figure sums the rows that carry it and reports its coverage;
// the outlay and the owner-earnings yield exist only over rows the reader priced, and only
// where the owner-earnings figure exists beside the price (never a yield on a mixed base).
export function statementTotals(rows, prices = {}) {
  const byCcy = new Map();
  for (const r of rows) {
    if (!r) continue;
    const t = byCcy.get(r.ccy) ?? {
      ccy: r.ccy, sym: r.sym, n: 0,
      rev: 0, revN: 0, oe: 0, oeN: 0, ni: 0, niN: 0, netDebt: 0, netDebtN: 0,
      outlay: 0, oeOnOutlay: 0, pricedN: 0,
    };
    t.n++;
    if (r.rev != null) { t.rev += r.rev; t.revN++; }
    if (r.oe != null) { t.oe += r.oe; t.oeN++; }
    if (r.ni != null) { t.ni += r.ni; t.niN++; }
    if (r.netDebt != null) { t.netDebt += r.netDebt; t.netDebtN++; }
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
  }));
}
