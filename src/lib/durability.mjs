// Durability & moat report card — turns ~10 years of filings into the judgments
// Graham (stability) and Buffett (a moat that doesn't fade, capital reinvested at
// high returns) actually rendered. Every line is computed from the record; no
// opinion is added. The centerpiece is incremental ROIC — the return earned on
// the capital the business plowed back, which separates a compounding moat from
// one that's merely being milked.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const firstN = (arr, n) => arr.filter((x) => x != null).slice(0, n);
const lastN = (arr, n) => arr.filter((x) => x != null).slice(-n);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const avgFirst = (arr, n) => { const s = firstN(arr, n); return s.length ? mean(s) : null; };
const avgLast = (arr, n) => { const s = lastN(arr, n); return s.length ? mean(s) : null; };
const cagr = (a, b, yrs) => (a > 0 && b > 0 && yrs > 0 ? Math.pow(b / a, 1 / yrs) - 1 : null);
const pct = (v, dp = 0) => (v == null ? "—" : `${v < 0 ? "−" : ""}${(Math.abs(v) * 100).toFixed(dp)}%`);

function nopat(L) {
  if (!L || L.operatingIncome == null) return null;
  let t = 0.21;
  if (L.incomeTaxExpense != null && L.netIncome != null && L.netIncome + L.incomeTaxExpense > 0)
    t = clamp(L.incomeTaxExpense / (L.netIncome + L.incomeTaxExpense), 0, 0.5);
  return L.operatingIncome * (1 - t);
}
function invested(L) {
  if (!L || L.totalDebt == null || L.stockholdersEquity == null) return null;
  const iv = L.totalDebt + L.stockholdersEquity - (L.cashAndEquivalents || 0);
  return iv > 0 ? iv : null;
}

export function moatReport(company) {
  const H = (company.history || []).filter((h) => h?.lines?.revenue != null);
  if (H.length < 4) return null;
  const L = H.map((h) => h.lines);
  const years = H.map((h) => h.fy);
  const span = years[years.length - 1] - years[0];
  const facts = [];
  const add = (label, value, tone, note) => facts.push({ label, value, tone, note });

  // 1 — Stability: did it ever lose money?
  const ni = L.map((x) => x.netIncome).filter((x) => x != null);
  const profitable = ni.filter((x) => x > 0).length;
  add("Profitable years", `${profitable} of ${ni.length}`,
    profitable === ni.length ? "good" : profitable >= ni.length - 1 ? "ok" : "warn",
    profitable === ni.length
      ? "Never lost money over the record — the earnings stability Graham insisted on."
      : `Lost money in ${ni.length - profitable} year(s) — look at what happened there before trusting the average.`);

  // 2 — Moat: does the return on capital persist?
  const roics = L.map((x) => { const iv = invested(x), np = nopat(x); return iv && np != null ? np / iv : null; }).filter((r) => r != null);
  if (roics.length >= 3) {
    const above = roics.filter((r) => r >= 0.15).length;
    add("Return on capital ≥ 15%", `${above} of ${roics.length} yrs`,
      above >= roics.length - 1 ? "good" : above >= roics.length * 0.5 ? "ok" : "warn",
      "A moat shows up as a high return on invested capital that holds year after year — not one good vintage.");
  }

  // 3 — Pricing power: where did the operating margin go? Anchored to the first
  // and last years on record (both findable in the table), not hidden averages.
  const om = L.map((x) => (x.operatingIncome != null && x.revenue ? x.operatingIncome / x.revenue : null));
  const fI = om.findIndex((v) => v != null);
  const lI = om.length - 1 - [...om].reverse().findIndex((v) => v != null);
  if (fI >= 0 && lI > fI) {
    const d = om[lI] - om[fI];
    const dir = d > 0.02 ? "good" : d < -0.02 ? "warn" : "ok";
    add("Operating margin", `${pct(om[fI])} (FY${years[fI]}) → ${pct(om[lI])} (FY${years[lI]})`, dir,
      d > 0.02 ? "Margins widened over the record — pricing power intact or improving."
        : d < -0.02 ? "Margins slipped over the record — competition or costs are biting in."
        : "Margins held roughly steady across the record.");
  }

  // 4 — The centerpiece: incremental ROIC (what reinvested capital earned).
  const npE = avgFirst(L.map(nopat), 3), npL = avgLast(L.map(nopat), 3);
  const ivE = avgFirst(L.map(invested), 3), ivL = avgLast(L.map(invested), 3);
  if (npE != null && npL != null && ivE != null && ivL != null) {
    const dNop = npL - npE, dInv = ivL - ivE;
    if (dInv > ivE * 0.1) {
      const inc = dNop / dInv;
      add("Reinvestment — incremental ROIC", pct(inc),
        inc >= 0.15 ? "good" : inc >= 0.08 ? "ok" : "warn",
        inc >= 0.15 ? "Every extra dollar the company reinvested earned a high return — it is still compounding, not coasting on an old moat."
          : inc >= 0 ? "Reinvested capital earned only a modest return — growth is getting expensive."
          : "Reinvested capital earned a negative return — the business spent money to shrink its own economics.");
    } else {
      add("Reinvestment — incremental ROIC", "returns capital", "info",
        "The capital base barely grew: this business returns cash through dividends and buybacks rather than reinvesting. Judge it on the cash returned, not on compounding.");
    }
  }

  // 5 — How fast did owner earnings compound?
  const oe = L.map((x) => (x.cashFromOps != null && x.capex != null ? x.cashFromOps - Math.abs(x.capex) : null));
  const oeE = avgFirst(oe, 2), oeL = avgLast(oe, 2);
  const g = oeE != null && oeL != null ? cagr(oeE, oeL, span) : null;
  if (g != null) add("Owner earnings growth", `${g >= 0 ? "+" : "−"}${pct(Math.abs(g))}/yr`,
    g >= 0.1 ? "good" : g >= 0 ? "ok" : "warn",
    `Free cash to owners ${g >= 0 ? "grew" : "shrank"} about ${pct(Math.abs(g))} a year over the record.`);

  // 6 — Resilience: the worst year.
  let wi = -1, wv = Infinity;
  om.forEach((v, i) => { if (v != null && v < wv) { wv = v; wi = i; } });
  if (wi >= 0) add("Worst year", `${years[wi]} · ${pct(wv, 1)} op. margin`,
    wv > 0 ? "good" : "warn",
    wv > 0 ? "Stayed profitable even in its hardest year — the resilience that survives recessions."
      : `Operations went underwater in ${years[wi]} — understand why before trusting the good years.`);

  // 7 — Per-share: is the slice growing or shrinking? (guard against unadjusted splits)
  const sh = L.map((x) => x.sharesDiluted);
  const shF = sh.find((x) => x != null), shL = [...sh].reverse().find((x) => x != null);
  if (shF && shL && Math.max(shF, shL) / Math.min(shF, shL) <= 1.8 && span > 0) {
    const sg = Math.pow(shL / shF, 1 / span) - 1;
    add("Share count", `${sg >= 0 ? "+" : "−"}${pct(Math.abs(sg), 1)}/yr`,
      sg < -0.005 ? "good" : sg > 0.01 ? "warn" : "ok",
      sg < -0.005 ? "The share count is shrinking — buybacks are quietly growing your slice of the business."
        : sg > 0.01 ? "The share count is rising — dilution works against you on a per-share basis."
        : "Roughly flat share count — little dilution, little buyback.");
  }

  // 8 — Dividend continuity.
  const divs = L.map((x) => (x.dividendsPaid != null ? Math.abs(x.dividendsPaid) : null));
  const paidYrs = divs.filter((d) => d != null && d > 0).length;
  if (paidYrs > 0) {
    const dF = divs.find((d) => d), dL = [...divs].reverse().find((d) => d);
    const grew = dF && dL && dL > dF * 1.05;
    add("Dividend record", grew ? "rising" : "paid", grew ? "good" : "ok",
      grew ? "Paid and raised the dividend across the record — the continuity Graham prized."
        : `Paid a dividend in ${paidYrs} of the years on record.`);
  }

  return { years, facts };
}
