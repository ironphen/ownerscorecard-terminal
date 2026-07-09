// flags.mjs — the five named ways to die, each a register a reader can open to see who else
// did this. A pure decomposition of the red-flags archetype (plus the bought-their-growth read
// the acquisitions panel already computes): the same guarded reads the company page runs, split
// out one register per disqualifying fact, each row carrying the fact's own figure. No score is
// formed across registers; a register is a list of a single kind of fact, ordered by that fact's
// own magnitude, and the reader draws the conclusion. Consumed by /flags (the hub and one page
// per register) and by the case-against strip on company pages, so "who fired this" and "what
// fired here" can never disagree.
import { capitalHistory } from "./capital.mjs";
import { forensicScreen, fmtMoney } from "./fundamentals.mjs";
import { acquisitionRecord } from "./acquisitions.mjs";

const safe = (fn, c) => { try { return fn(c); } catch { return null; } };
const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;

// The registers, in the fixed order the hub lists them. `describe` is the hub's one-line account
// of what lands a company here; the thresholds are the red-flags lens's own (stated, not tuned).
export const REGISTERS = [
  {
    slug: "restated-or-weakness",
    title: "Restated, or admitted a control weakness",
    describe:
      "The filing itself concedes the books: prior financials restated, or management admitting a material weakness in its controls over reporting. The gravest register, in the company's own words.",
  },
  {
    slug: "serial-diluters",
    title: "Serial diluters",
    describe:
      "The split-adjusted share count at least doubled across the record — the owner's stake halved by issuance — measured net of splits, with any buyback spend over the same span shown beside it.",
  },
  {
    slug: "earnings-ahead-of-cash",
    title: "Earnings ahead of cash",
    describe:
      "Reported profit ran persistently ahead of operating cash (the through-cycle accrual gap), corroborated by a manipulation screen of eight balance-sheet ratios or wide enough to stand alone. Sometimes inventory in a real grower; sometimes earnings leaning on estimates.",
  },
  {
    slug: "bought-their-growth",
    title: "Bought their growth",
    describe:
      "Goodwill from past deals at or above all book equity — the business on the balance sheet is mostly the premium paid for other businesses — or acquisitions already conceded by write-down.",
  },
  {
    slug: "sells-hard",
    title: "Sells hard, steers past GAAP",
    describe:
      "The MD&A leans on promotional language and non-GAAP figures at rates near the top of the catalog. Not an accounting fact; a reading of how management talks when it reports to owners.",
  },
];

export const REGISTER_BY_SLUG = Object.fromEntries(REGISTERS.map((r) => [r.slug, r]));

// Every register this company fires, with the disqualifying fact stated in figures. `lang` is the
// company's entry from language.json (candor and integrity reads); pass null when unavailable.
// Returns [] when nothing fired. `sort` is the fact's own magnitude within its register, used only
// to order that register's page — magnitudes are never compared across registers.
export function firedRegisters(company, lang) {
  const out = [];
  const ccy = company?.currency || "USD";
  const $ = (v) => fmtMoney(v, ccy);
  const integrity = lang?.buffettRead?.integrity || null;
  const cd = lang?.mdna?.candor || null;

  if (integrity?.restatement || integrity?.materialWeakness) {
    const what = [
      integrity.restatement ? "restated prior financials" : null,
      integrity.materialWeakness ? "admitted a material weakness in controls" : null,
    ].filter(Boolean).join("; ");
    out.push({
      slug: "restated-or-weakness",
      figure: what,
      sort: (integrity.restatement ? 2 : 0) + (integrity.materialWeakness ? 1 : 0),
    });
  }

  const cap = safe(capitalHistory, company);
  // Above 50× the count didn't dilute, it changed basis (an IPO restructuring, a share-class
  // conversion) — a magnitude that would top the register while describing nothing. Withheld.
  if (cap?.shareChange != null && cap.shareChange >= 1.0 && cap.shareChange <= 50) {
    out.push({
      slug: "serial-diluters",
      figure: `split-adjusted shares +${pct(cap.shareChange)} over ${cap.span}${cap.bb > 0 ? `, despite ${$(cap.bb)} spent on buybacks` : ""}`,
      sort: cap.shareChange,
    });
  }

  const f = safe(forensicScreen, company);
  if (f && f.accrualTC != null && ((f.mElevated && f.accrualTC > 0.02) || f.accrualTC > 0.05)) {
    out.push({
      slug: "earnings-ahead-of-cash",
      figure: `accruals about ${pct(f.accrualTC)} of assets a year through the cycle${f.mElevated ? "; the eight-ratio manipulation screen trips too" : ""}`,
      sort: f.accrualTC,
    });
  }

  const acq = safe(acquisitionRecord, company);
  if (acq && (acq.exceedsEquity || (acq.cumImp > 0 && (!acq.equityPositive || (acq.equity != null && acq.cumImp >= acq.equity * 0.05))))) {
    const parts = [];
    if (acq.exceedsEquity) parts.push(`goodwill ${$(acq.goodwill)} vs all book equity ${$(acq.equity)}`);
    // The "% of the cash put in" reading needs the deals to be on the record: when write-downs
    // exceed 150% of recorded deal spend, the spend predates the record and the ratio is a
    // denominator artifact — the dollar figure stands alone.
    const wds = acq.writtenDownShare != null && acq.writtenDownShare <= 1.5 ? acq.writtenDownShare : null;
    if (acq.cumImp > 0) parts.push(`${$(acq.cumImp)} of past deals written down${wds != null ? ` (${pct(wds)} of the cash put in)` : ""}`);
    out.push({
      slug: "bought-their-growth",
      figure: parts.join("; "),
      // An unknown relative size has no magnitude to sort by; it goes to the back of the
      // register, not the front.
      sort: acq.exceedsEquity ? 1 + (acq.gwVsEquity || 0) : (wds ?? 0),
    });
  }

  if ((cd?.promo || 0) >= 0.8 && (cd?.adjusted || 0) >= 4.8) {
    out.push({
      slug: "sells-hard",
      figure: `promotional language at ${cd.promo.toFixed(1)} and non-GAAP references at ${cd.adjusted.toFixed(1)} per thousand words of MD&A`,
      sort: cd.promo + cd.adjusted / 10,
    });
  }

  return out;
}

// firedRegisters over the whole universe, once: per-register member lists, each ordered by the
// fact's own magnitude (descending, alphabetical tiebreak). Memoized globally for the build, the
// same way computeLenses is — the hub and every register page call this, and the dataset is
// always the same canonical set, so the heavy pass runs a single time and the hub's counts can
// never disagree with the pages' rows. `langMap` is language.json's companies map, keyed by ticker.
let _regCache = null;
export function computeRegisters(companies, langMap) {
  if (_regCache) return _regCache;
  const bySlug = Object.fromEntries(REGISTERS.map((r) => [r.slug, []]));
  for (const company of companies || []) {
    const tk = String(company.ticker || "").toUpperCase();
    if (!tk) continue;
    const lang = langMap?.[company.ticker] || null;
    for (const fired of firedRegisters(company, lang)) {
      bySlug[fired.slug].push({ ticker: tk, name: company.name || "", figure: fired.figure, sort: fired.sort });
    }
  }
  for (const slug of Object.keys(bySlug)) {
    bySlug[slug].sort((a, b) => b.sort - a.sort || a.ticker.localeCompare(b.ticker));
  }
  _regCache = bySlug;
  return bySlug;
}
