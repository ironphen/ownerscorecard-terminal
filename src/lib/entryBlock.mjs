// The Entry Block's facts — docs/discovery-design.md feature 1. Five fixed lines, identical
// wherever a company appears on a reading surface: identity and lede; the ten-year owner-earnings
// row; the retained-capital arithmetic as a sentence of numbers; balance-sheet posture and
// stewardship facts; the archetype chips. Everything here is a figure or a factual sentence built
// from the same libraries the company page runs, so an entry can never disagree with the page it
// links to. Absence renders "not read" (or, for a balance-sheet business, "not applied") — never
// a mark against a filled cell, never a grade.
//
// The caller passes the per-company extras (the language lede, the segment mix, a reviewed note)
// so this lib stays JSON-free and runnable under plain node. Cached per company object: the Manual
// renders ~3,530 of these in one build, and later surfaces (chapters, the punch card) will render
// the same companies again.
import { capitalHistory } from "./capital.mjs";
import { cashPosition, fmtMoney, currencySymbol, ownerEarningsAbs } from "./fundamentals.mjs";
import { businessPhrase, weakLede } from "./business.mjs";
import { compositionSentence } from "./segments.mjs";
import { classify } from "./archetype.mjs";

const safe = (fn, c) => {
  try {
    return fn(c);
  } catch {
    return null;
  }
};

// A share price for the buyback line: cents matter under a hundred, not above.
const priceStr = (v, cur) => {
  const sym = currencySymbol(cur);
  return `${sym}${v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2)}`;
};

// Line 3: the retained-capital arithmetic as a sentence of numbers. Retained = net income kept
// after dividends and buybacks (capitalHistory's own figure, the denominator its return-on-retained
// uses); growth = the change in annual owner earnings, first three years of the record against the
// last three. Stated, never graded.
function retainedSentence(cap, cur) {
  if (!cap || cap.retainedEarnings == null) return null;
  const $ = (v) => fmtMoney(v, cur);
  const sym = currencySymbol(cur);
  const re = cap.retainedEarnings;
  const inc = cap.incrementalOE;
  const grewClause =
    inc != null ? `annual owner earnings ${inc >= 0 ? "grew" : "fell"} ${$(Math.abs(inc))}` : null;
  if (re > 0) {
    const rr = cap.returnOnRetained;
    const per = rr != null ? `, ${sym}${rr.toFixed(2)} per ${sym}1 retained` : "";
    return grewClause
      ? `Retained ${$(re)} of earnings over ${cap.span}; ${grewClause}${per}.`
      : `Retained ${$(re)} of earnings over ${cap.span}.`;
  }
  // Nothing retained on net: dividends and buybacks exceeded the earnings of the span.
  return grewClause
    ? `Paid out ${$(-re)} more than it earned over ${cap.span}; ${grewClause}.`
    : `Paid out ${$(-re)} more than it earned over ${cap.span}.`;
}

const _cache = new WeakMap();

// extras: { lang, seg, note } — the company's language.json entry, segments.json entry, and a
// reviewed note (already passed through pickNote). All optional.
export function entryFacts(company, extras = {}) {
  const hit = _cache.get(company);
  if (hit) return hit;

  const ticker = String(company.ticker || "").toUpperCase();
  const cur = company.currency || "USD";
  const cls = safe(classify, company);
  const isFin = !!cls && ["financial", "reit"].includes(cls.sector?.key);

  // Line 1: the lede — the same chain the company page's hero runs (reviewed note first, then the
  // filing's own description when it actually describes the business, then the revenue mix, then
  // the computed industry phrase), so the Manual and the page always open on the same sentence.
  const rawBiz = extras.lang?.business || null;
  const lede =
    extras.note?.whatItIs ||
    (rawBiz && !weakLede(rawBiz)
      ? rawBiz
      : compositionSentence(extras.seg) || safe(businessPhrase, company)) ||
    null;

  // Line 2: the ten-year owner-earnings row. For a bank, insurer or REIT the read is a category
  // error (the company page withholds it the same way), so the line says "not applied" rather
  // than render a figure that means nothing.
  let oe = null;
  if (!isFin) {
    const figs = (company.history || [])
      .map((h) => ({ fy: h.fy, v: ownerEarningsAbs(h.lines, company) }))
      .filter((f) => f.v != null && f.fy != null);
    if (figs.length) {
      oe = {
        span: figs.length > 1 ? `${figs[0].fy}–${figs[figs.length - 1].fy}` : `FY${figs[0].fy}`,
        figs: figs.map((f) => ({ fy: f.fy, label: fmtMoney(f.v, cur) })),
        series: figs.map((f) => f.v),
      };
    }
  }

  // Lines 3 and 4 read capitalHistory once. The retention arithmetic and the net-cash read are
  // operating-company reads, withheld from financials as the company page withholds them; the
  // stewardship facts (buyback price, the dividend record) are plain cash arithmetic and stand
  // for every kind of company.
  const cap = safe(capitalHistory, company);
  const retained = isFin ? null : retainedSentence(cap, cur);

  let posture = null;
  if (!isFin) {
    const cp = safe(cashPosition, company);
    if (cp && cp.tone === "none") posture = "net position not read (debt under-captured)";
    else if (cp) posture = `${cp.label}, ${cp.value}`;
  }

  const stewardship = [];
  if (cap?.avgBuybackPrice != null)
    stewardship.push(`buybacks at an average near ${priceStr(cap.avgBuybackPrice, cur)}`);
  if (cap) {
    const nYears = (company.history || []).filter(
      (h) => h?.lines?.cashFromOps != null && h?.lines?.capex != null
    ).length;
    if (cap.divYears > 0) {
      // Claim cut / never-cut only where the per-share series existed to check it.
      const cutClause =
        cap.dpsFirst != null && cap.dpsLast != null
          ? cap.everCut
            ? ", cut at least once"
            : ", never cut"
          : "";
      stewardship.push(`dividend paid ${cap.divYears} of ${nYears} yrs${cutClause}`);
    } else if (cap.divReported) {
      stewardship.push("no dividend paid");
    }
  }

  const facts = {
    ticker,
    name: company.name || "",
    cur,
    isFin,
    lede,
    oe,
    retained,
    posture,
    stewardship,
  };
  _cache.set(company, facts);
  return facts;
}
