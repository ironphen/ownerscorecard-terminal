// compareCard.mjs — the slim, build-time record behind one column of the head-to-head compare view.
// Pure recomputation from the fundamentals we already hold (no new fetch, no price, no LLM): the GBM
// reading of a business reduced to the handful of figures an owner weighs when choosing between two
// businesses — can it die, does it compound, is it run for owners, how does it talk — plus the inputs
// the shared reverse-DCF needs to turn a reader's price into "what you'd have to believe."
//
// Emitted one-per-company by src/pages/compare/[ticker].json.js, so the compare page fetches only the
// two-to-four cards a reader actually picked. The reverse-DCF inputs come from valuationModel(), the
// same source the company-page valuation reads, so a column reproduces that page to the digit.

import { classify, financialKind } from "./archetype.mjs";
import {
  throughCycle, roicValue, operatingMargin, grossMargin, ownerEarningsMargin,
  ownerEarningsAbs, topLineRevenue, debtReliable, currencySymbol,
} from "./fundamentals.mjs";
import { returnOnEquity } from "./financials.mjs";
import { grahamTests } from "./graham.mjs";
import { capitalHistory } from "./capital.mjs";
import { valuationModel } from "./valuationInputs.mjs";
import { adrBasis } from "./adrBasis.mjs";
import adrRatios from "../data/adrRatios.json" with { type: "json" };
import rates from "../data/rates.json" with { type: "json" };

// Keep the JSON slim and free of false precision: money and share counts to whole units, ratios and
// growth rates to six decimals (more than the reverse-DCF or any display needs). null passes through.
const money = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v));
const rate = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1e6) / 1e6);
const tc = (t) => (t == null ? null : { median: rate(t.median), lo: rate(t.lo), hi: rate(t.hi), n: t.n });

// Owner-earnings growth the record delivered: the same 2-year-averaged-endpoint CAGR the durability
// report shows as its headline "Owner earnings growth," recomputed here so the compare column's
// delivered-vs-implied read sits on the figure the company page features.
function deliveredOeGrowth(company) {
  const H = (company.history || []).filter((h) => h?.lines?.revenue != null);
  if (H.length < 4) return null;
  const oe = H.map((h) => ownerEarningsAbs(h.lines, company));
  const firstN = (n) => oe.filter((x) => x != null).slice(0, n);
  const lastN = (n) => oe.filter((x) => x != null).slice(-n);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const oeE = mean(firstN(2)), oeL = mean(lastN(2));
  const span = H[H.length - 1].fy - H[0].fy;
  return oeE != null && oeL != null && oeE > 0 && oeL > 0 && span > 0 ? Math.pow(oeL / oeE, 1 / span) - 1 : null;
}

// Per-share compound growth, split-adjusted. Same shape the ten-year table's "annual rates of change
// (per sh)" block shows: the diluted-share series is normalized to the latest basis (a stock split
// can't masquerade as dilution), then each owner figure is reduced to one share and compounded across
// the record (full span) and over the last five years. Endpoint CAGR on positive endpoints only.
function perShareCagr(company) {
  const H = (company.history || []).filter((h) => h?.lines);
  if (H.length < 3) return null;
  // Split-normalize: walk the share series newest-to-oldest, carrying a factor that snaps any split-
  // sized jump so earlier years sit on the latest basis (the same jump test the table uses).
  const s = H.map((h) => h.lines.sharesDiluted ?? null);
  const factor = new Array(s.length).fill(1);
  let f = 1;
  for (let i = s.length - 1; i > 0; i--) {
    factor[i] = f;
    let j = i - 1;
    while (j >= 0 && s[j] == null) j--;
    if (j >= 0 && s[i] != null && s[j] != null && s[j] > 0) {
      const r = s[i] / s[j];
      if (r > 1.4 || r < 0.7) f *= r;
    }
  }
  factor[0] = f;
  const shAt = (i) => (s[i] != null ? s[i] * factor[i] : null);
  const ps = (i, n) => { const sh = shAt(i); return n != null && sh ? n / sh : null; };
  const metric = (valOf) => {
    const pts = H.map((h, i) => ({ fy: h.fy, v: valOf(h.lines, i) })).filter((p) => p.v != null && Number.isFinite(p.v));
    if (pts.length < 2) return null;
    const cagr = (window) => {
      const b = pts[pts.length - 1];
      let a = pts[0];
      if (window) { const cand = pts.filter((p) => p.fy >= b.fy - window && p.fy < b.fy); a = cand.length ? cand[0] : null; }
      if (!a) return null;
      const yrs = b.fy - a.fy;
      return yrs > 0 && a.v > 0 && b.v > 0 ? rate(Math.pow(b.v / a.v, 1 / yrs) - 1) : null;
    };
    return { full: cagr(null), five: cagr(5) };
  };
  return {
    revenuePS: metric((L, i) => ps(i, topLineRevenue(L, company))),
    ownerEarningsPS: metric((L, i) => ps(i, ownerEarningsAbs(L, company))),
    eps: metric((L, i) => ps(i, L.netIncome)),
    dps: metric((L, i) => ps(i, L.dividendsPaid != null ? Math.abs(L.dividendsPaid) : null)),
    bvps: metric((L, i) => ps(i, L.stockholdersEquity)),
  };
}

function survival(company, vm) {
  const L = company.ttm?.lines || company.lines || {};
  const oi = L.operatingIncome, debt = L.totalDebt, ie = L.interestExpense;
  const ca = L.currentAssets, cl = L.currentLiabilities;
  const leverageYears = debtReliable(L) && debt != null && oi != null && oi > 0 ? rate(debt / oi) : null;
  const interestCoverage = oi != null && ie != null && Math.abs(ie) > 0 ? rate(oi / Math.abs(ie)) : null;
  const currentRatio = ca != null && cl != null && cl > 0 ? rate(ca / cl) : null;
  // Graham's defensive tests as FACTS, one per test — name, the figure, and where it stands —
  // never reduced to a count (a count is halfway to a score, the least doctrinal possible form
  // and the least useful to Graham, who compared candidates test by test).
  const g = grahamTests(company);
  const grahamRows = (g.tests || []).map((t) => ({ name: t.name, value: t.value ?? null, status: t.status, criterion: t.criterion ?? null }));
  const ni = (company.history || []).map((h) => h?.lines?.netIncome).filter((v) => v != null);
  const profitable = ni.filter((v) => v > 0).length;
  return {
    netDebt: money(vm.netDebt), netCash: vm.netDebt < 0,
    leverageYears, interestCoverage, currentRatio,
    graham: grahamRows,
    profitableYears: ni.length ? profitable : null, recordYears: ni.length || null,
  };
}

function stewardship(company) {
  const L = company.ttm?.lines || company.lines || {};
  const cap = capitalHistory(company);
  const eq = L.stockholdersEquity, ni = L.netIncome, div = L.dividendsPaid;
  const retainedToEquity = ni != null && div != null && eq && eq > 0 ? rate((ni - Math.abs(div)) / eq) : null;
  return {
    shareChange: cap ? rate(cap.shareChange) : null,
    // The record's starting share count on today's split-adjusted basis — the filed number
    // /owner's then-fraction line divides by, replacing an approximation that mixed the
    // diluted-average series with the cover count.
    firstShares: cap ? money(cap.firstShares) : null,
    returnOnRetained: cap ? rate(cap.returnOnRetained) : null,
    payoutOfOwnerEarnings: cap ? rate(cap.returnedOfOE) : null,
    dpsGrowth: cap ? rate(cap.dpsGrowth) : null,
    dividendEverCut: cap ? cap.everCut : null,
    divYears: cap ? cap.divYears : null,
    // The blended price paid for the record's buybacks, only where it survived the reliability
    // gates — set beside the price the reader types one band below, it is Buffett's
    // two-buyback-disciplines comparison with no judgment rendered.
    avgBuybackPrice: cap && !cap.bbPriceUnreliable ? rate(cap.avgBuybackPrice) : null,
    buybackSpan: cap ? cap.span : null,
    retainedToEquity,
  };
}

function quality(company, vm) {
  const fk = financialKind(company);
  const fin = !!fk;
  const L = company.ttm?.lines || company.lines || {};
  return {
    roicThroughCycle: fin ? null : tc(throughCycle(company, roicValue)),
    roeThroughCycle: tc(throughCycle(company, returnOnEquity)),
    // Return on tangible equity is the bank/insurer return read; for a non-financial it is an artifact
    // of a near-zero tangible book (Apple's 100%+), so it's carried only where it means something.
    rotce: vm.isBank && vm.rotce != null ? rate(vm.rotce) : null,
    operatingMarginThroughCycle: tc(throughCycle(company, operatingMargin)),
    ownerEarningsMarginThroughCycle: tc(throughCycle(company, (l) => ownerEarningsMargin(l, company))),
    grossMarginLatest: rate(grossMargin(L)),
    ffoPerShare: fk === "reit" && vm.ffops != null ? rate(vm.ffops) : null,
  };
}

// The reverse-DCF inputs, by lens. Spread from valuationModel so a compare column reproduces the
// company-page valuation. Each lens's fields are emitted ONLY for its own kind of business:
// valuationModel computes bank and REIT figures unconditionally (finKind even defaults to
// "bank"), and spreading them for a software company published flat falsehoods on a public
// endpoint — Adobe with a 330% "return on tangible equity" and an FFO per share. The `adrWarn`
// flag marks the one remaining un-convertible case (no ADS ratio or FX), where the renderer
// must still ask for the home-market ordinary-share price.
function priceBlock(company, vm, currency, sym, adrWarn) {
  const isBank = vm.mode === "bank";
  const isReit = vm.mode === "reit";
  // Dividends paid, from the SAME line basis as netIncome and every flow here — never a
  // fallback across bases (a TTM profit beside an FY dividend is the mixed-vintage split
  // the design forbids). The TTM stitch carries the line since 2026-07; a pre-refresh TTM
  // record reads null (a dash) until refetched, which is the honest state. A filed zero
  // stays zero — a non-payer's zero is a fact, an absent tag is not.
  const priceL = company.ttm?.lines || company.lines || {};
  const dL = priceL.dividendsPaid ?? null;
  return {
    mode: vm.mode, currency, sym, adrBasis: adrWarn,
    shares: money(vm.shares), netDebt: money(vm.netDebt),
    div: dL != null ? money(Math.abs(dL)) : null,
    // owner-earnings lens
    oe: money(vm.oe), oeNormalized: money(vm.oeNormalized), oeMaint: money(vm.oeMaint),
    oe3: money(vm.oe3), oe3Maint: money(vm.oe3Maint), sbc: money(vm.sbc),
    offerMaint: vm.offerMaint, defaultMaint: vm.defaultMaint, defaultNorm: vm.defaultNorm,
    eps3: rate(vm.eps3), bvps: rate(vm.bvps), gDeliv: rate(vm.gDeliv),
    rev: money(vm.rev), gRev: rate(vm.gRev), ni: money(vm.ni),
    // bank / insurer lens — only where the business IS one
    ...(isBank ? {
      tbvps: rate(vm.tbvps), bvpsBank: rate(vm.bvpsBank), epsBank: rate(vm.epsBank),
      rotce: rate(vm.rotce), tbvGrowth: rate(vm.tbvGrowth), finKind: vm.finKind,
    } : {}),
    // REIT lens — only for a REIT
    ...(isReit ? { ffops: rate(vm.ffops), dpsReit: rate(vm.dpsReit), ffoGrowth: rate(vm.ffoGrowth) } : {}),
    // negative-owner-earnings lens
    oeMarginNow: rate(vm.oeMarginNow), profitableNeg: vm.profitableNeg,
  };
}

// Build one company's compare card.
export function buildCompareCard(rawCompany) {
  // ADR basis conversion, the same one the company page runs (lib/adrBasis.mjs): a column with a
  // known ADS ratio and FX rate is stated in USD per ADS — the quote a US reader actually holds —
  // so the compare price row and /c/<ticker> can never give contradictory instructions.
  const ab = adrBasis(rawCompany, adrRatios, rates);
  const company = ab.co;
  const cls = classify(company);
  const vm = valuationModel(company);
  const pool = rawCompany.market === "ADR" ? "ADR" : rawCompany.market === "JP" ? "JP" : "US";
  const currency = company.currency || "USD";
  const sym = currencySymbol(currency);
  // The record's true depth: the span of years that carry any core figure. Revenue alone would
  // understate the Japanese pool, where EDINET's five-year summary tags net income and cash flow back
  // further than revenue — so a column's "5-yr record" chip reflects the cash record, not the shorter
  // revenue one. The chip exists precisely so a reader sees a 5-year JP record beside a 10-year US one.
  const H = (company.history || []).filter((h) => h?.lines && (h.lines.netIncome != null || h.lines.revenue != null || h.lines.cashFromOps != null));
  const spanYears = H.length ? H[H.length - 1].fy - H[0].fy + 1 : null;
  const spanLabel = H.length ? `${H[0].fy}–${H[H.length - 1].fy}` : null;

  return {
    ticker: String(company.ticker || "").toUpperCase(),
    name: company.name || company.ticker,
    pool, currency, sym, fy: company.fy ?? null, form: company.form || null,
    archetype: {
      key: cls.sector.key, label: cls.sector.label, adj: cls.sector.adj,
      industry: cls.industry.label, financialKind: financialKind(company) || null,
      overlays: cls.overlays.map((o) => o.key),
    },
    recordYears: spanYears, spanLabel,
    // The price-entry basis, stated: converted columns carry the terms so the page can print them.
    basis: {
      adr: ab.isADR, auto: ab.auto, homeCcy: ab.homeCcy,
      ratio: ab.ratio, kind: ab.basis, fxUsd: ab.fxUsd != null ? rate(ab.fxUsd) : null, fxAsOf: ab.fxAsOf,
    },
    quality: quality(company, vm),
    compounding: { perShare: perShareCagr(company), ownerEarningsGrowthDelivered: rate(deliveredOeGrowth(company)), revenueGrowthDelivered: rate(vm.gRev) },
    survival: survival(company, vm),
    stewardship: stewardship(company),
    price: priceBlock(company, vm, currency, sym, ab.isADR && !ab.auto),
  };
}
