// The owner's questions: the synthesis that turns sixteen sections of evidence into the few questions
// Graham, Buffett and Munger actually ask of a business, in the order they ask them — can I understand
// it, does it have a durable moat, will it survive a bad year, is it run by able and honest people, and
// only then, what would I have to believe to pay the price. Each question is answered with a FACT the
// page already computes, never a verdict, and points to the section that settles it. This teaches the
// method, not a conclusion: the questions stay open, the judgment stays the reader's. Present, never
// pronounce — the cardinal rule, applied to the one place most tempted to break it.
//
// Pure: the caller passes the language object in (for the candor and integrity reads), so this runs
// under plain node and is testable. Every fact here is the same figure shown in full in the section it
// links to, surfaced once at the top as the answer to the question it bears on.
import { moatReport } from "./durability.mjs";
import { financialKind } from "./archetype.mjs";
import { businessPhrase } from "./business.mjs";
import { throughCycleMetric } from "./peers.mjs";
import { returnOnEquity, equityToAssets } from "./financials.mjs";
import { debtToAssets } from "./reits.mjs";

const pctTC = (company, fn, dp = 0) => {
  const v = throughCycleMetric(company, fn);
  return v == null || !isFinite(v) ? null : `${v < 0 ? "−" : ""}${(Math.abs(v) * 100).toFixed(dp)}%`;
};
// The margin-trajectory word, read off the durability fact's tone so the synthesis and the moat report
// never disagree.
const dirWord = (tone) => (tone === "good" ? "widened" : tone === "warn" ? "narrowed" : "held");

// The catalog's top-decile thresholds for the language register (the same lines durability.mjs uses).
const OWNER_HI = 2.9, PROMO_HI = 0.8;
const registerWord = (candor) => {
  if (!candor) return null;
  const ownerHi = candor.owner != null && candor.owner >= OWNER_HI;
  const promoHi = candor.promo != null && candor.promo >= PROMO_HI;
  if (promoHi && !ownerHi) return "leans on a promoter’s vocabulary";
  if (ownerHi && !promoHi) return "talks in an owner’s terms";
  return null;
};

export function ownerQuestions(company, lang) {
  const fk = financialKind(company);
  const candor = lang?.mdna?.candor || null;
  const integ = lang?.buffettRead?.integrity || null;
  const moat = !fk ? moatReport(company, { pricing: lang?.buffettRead?.pricing || null, candor }) : null;
  const fact = (label) => moat?.facts.find((f) => f.label === label) || null;
  const out = [];

  // 1 — Can you understand how it makes money? The business and the one lever that decides it.
  out.push({
    key: "understand",
    q: "Can you understand how it makes money?",
    a: businessPhrase(company),
    href: "#sec-business", hrefLabel: "What it is",
  });

  // 2 — Does it have a durable moat? A high return on capital that has lasted, and where the margin went.
  let moatA = null;
  if (!fk) {
    const roic15 = fact("Return on capital ≥ 15%");
    const om = fact("Operating margin");
    const parts = [];
    if (roic15) parts.push(`return on capital cleared 15% in ${roic15.value}`);
    if (om) parts.push(`operating margins ${dirWord(om.tone)} over the record`);
    moatA = parts.length ? capitalize(parts.join(", and ")) + "." : "The record is too short to read the durability of returns yet — see the moat report.";
  } else if (fk === "reit") {
    moatA = "A property trust is read on its funds from operations and the leverage every REIT carries, not on a moat in the usual sense.";
  } else {
    const roe = pctTC(company, (L) => returnOnEquity(L));
    moatA = roe ? `Return on equity has run about ${roe} through the cycle — the engine of book-value compounding for this kind of business.` : "Read on the returns it earns on its balance sheet through the cycle.";
  }
  out.push({ key: "moat", q: "Does it have a durable moat?", a: moatA, href: "#sec-scorecard", hrefLabel: "Quality & the record" });

  // 3 — Will it survive a bad year? Stability across the record and the balance sheet at the trough.
  let soundA = null;
  if (!fk) {
    const prof = fact("Profitable years");
    const worst = fact("Worst year");
    const parts = [];
    if (prof) parts.push(`profitable in ${prof.value} years on record`);
    if (worst) parts.push(worst.tone === "good" ? "and stayed in the black even in its worst year" : "but operations went underwater in its worst year");
    soundA = parts.length ? capitalize(parts.join(" ")) + "." : "Judge soundness on the balance sheet and the worst year in the record.";
  } else if (fk === "reit") {
    const da = pctTC(company, (L) => debtToAssets(L));
    soundA = da ? `Debt has run about ${da} of assets — leverage is what turns a property downturn into a wipeout, so this is the number to weigh.` : "Weigh the leverage every REIT carries against a property downturn.";
  } else {
    const ea = pctTC(company, (L) => equityToAssets(L), 1);
    soundA = ea ? `Equity has been about ${ea} of assets — the capital cushion that absorbs a bad year for a lender.` : "Weigh the capital cushion that absorbs a credit or underwriting cycle.";
  }
  out.push({ key: "survive", q: "Will it survive a bad year?", a: soundA, href: "#sec-scorecard", hrefLabel: "Will it survive" });

  // 4 — Is it run by able, honest people for the owners? Candor in the words, and what they did with the cash.
  const reg = registerWord(candor);
  const segs = [];
  if (reg) segs.push(`management ${reg} in the MD&A`);
  if (integ?.materialWeakness) segs.push("disclosed a material weakness in its financial controls");
  else if (integ?.restatement) segs.push("restated previously reported figures");
  else if (candor?.admissions?.length) segs.push("owned a miss plainly, in its own words");
  let mgmtA = segs.length ? capitalize(segs.join(", and ")) : null;
  let shareClause = null;
  if (!fk) {
    const share = fact("Share count");
    if (share?.tone === "good") shareClause = "the share count is shrinking, buybacks quietly growing your slice";
    else if (share?.tone === "warn") shareClause = "the share count is rising, dilution working against you";
  }
  if (mgmtA && shareClause) mgmtA = `${mgmtA}; ${shareClause}`;
  else if (!mgmtA && shareClause) mgmtA = capitalize(shareClause);
  out.push({
    key: "management",
    q: "Is it run by able, honest people for the owners?",
    a: mgmtA ? finish(mgmtA) : "How management talks, what it admits, and what it does with the cash — the candor read settles it.",
    href: "#sec-candor", hrefLabel: "How management talks",
  });

  // 5 — What would you have to believe to pay the price? The reverse-DCF, anchored to delivered growth.
  let priceA;
  if (!fk) {
    const oeg = fact("Owner earnings growth");
    priceA = oeg
      ? `Owner earnings have grown ${oeg.value.replace("/yr", " a year")} over the record. Bring a price — the tool shows the growth you would have to believe to justify it, never a target.`
      : "Bring a price — the tool shows the owner-earnings growth you would have to believe to justify it, never a target.";
  } else {
    priceA = "Bring a price — the tool weighs it against what the record would have to keep delivering, on the lens this kind of business is valued on, never a target.";
  }
  out.push({ key: "price", q: "What would you have to believe to pay the price?", a: priceA, href: "#sec-price", hrefLabel: "What the price implies" });

  return out;
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
// Capitalize and ensure terminal punctuation for a clause assembled from parts.
function finish(s) { s = capitalize(s); return /[.!?]$/.test(s) ? s : s + "."; }
