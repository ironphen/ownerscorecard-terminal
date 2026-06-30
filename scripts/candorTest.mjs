// Offline regression test for candorSignals, the routine that reads HOW management talks to owners: the
// three vocabularies an owner weighs (an owner's own language, a promoter's superlatives, and the off-GAAP
// measures that ask you to read earnings management's way), plus the rarest tell — a first-person admission
// of a miss. The page no longer shows a per-1,000-word bar; it shows the actual WORDS the filing reached
// for, so this guards that the detectors surface the right verbatim phrases, rank them by how often the
// filing used them, restore the acronyms an owner expects (GAAP, EBITDA), dedupe surface variants, and keep
// the conditional/blame guards on admissions. It runs no network: each case is synthetic MD&A prose
// faithful to real 10-K phrasing. Run with `npm test`.
import { candorSignals } from "./fetchFilings.mjs";

const has = (arr, w) => Array.isArray(arr) && arr.includes(w);
const cases = [
  // 1. A promotional, off-GAAP-heavy filing surfaces the actual superlatives and the actual non-GAAP terms.
  ["promo-words", () => {
    const r = candorSignals(
      "Our world-class platform delivers best-in-class, industry-leading results through revolutionary, " +
      "game-changing technology. On an adjusted EBITDA basis, excluding certain one-time charges, our " +
      "non-GAAP earnings grew. Adjusted operating income on a constant currency basis was strong."
    );
    return has(r.promoWords, "world-class") && has(r.promoWords, "best-in-class") &&
      has(r.adjustedWords, "adjusted EBITDA") && has(r.adjustedWords, "non-GAAP") && r.promo > 0 && r.adjusted > 0;
  }],

  // 2. Frequency ranking: the phrase the filing used most leads the list.
  ["ranks-by-frequency", () => {
    const r = candorSignals("world-class world-class world-class best-in-class. We are world-class. A paradigm shift.");
    return r.promoWords[0] === "world-class";
  }],

  // 3. Acronyms an owner expects are restored even when the filing wrote them mid-sentence.
  ["acronyms-restored", () => {
    const r = candorSignals("We report non-gaap results and adjusted ebitda to supplement GAAP measures.");
    return has(r.adjustedWords, "non-GAAP") && r.adjustedWords.some((w) => /EBITDA/.test(w));
  }],

  // 4. An owner's vocabulary is surfaced and a clean filing carries no promoter / off-GAAP words.
  ["owner-words-clean", () => {
    const r = candorSignals(
      "We manage the business for long-term per-share value and return on invested capital. " +
      "Free cash flow was reinvested at attractive returns and book value per share compounded."
    );
    return has(r.ownerWords, "return on invested capital") && r.ownerWords.length >= 3 &&
      r.promoWords.length === 0 && r.adjustedWords.length === 0;
  }],

  // 5. Case-and-hyphen variants of the same superlative dedupe to one entry.
  ["dedupes-variants", () => {
    const r = candorSignals("Our World-Class team. A world-class result. Truly world-class.");
    return r.promoWords.filter((w) => w === "world-class").length === 1;
  }],

  // 6. A first-person past-tense admission is captured; a forward-looking risk is not.
  ["admission-captured", () => {
    const r = candorSignals(
      "We were disappointed with our results in the segment this year and fell short of our own plan. " +
      "Our results could fall short in the future if demand weakens."
    );
    return r.admissions.length >= 1 && r.admissions.some((s) => /disappointed/i.test(s)) &&
      !r.admissions.some((s) => /could fall short in the future/i.test(s));
  }],

  // 7. A miss pinned on a third party is NOT an admission (owning a miss means owning it).
  ["blame-not-admission", () => {
    const r = candorSignals("Our key supplier failed to meet its obligations during the year, which hurt results.");
    return r.admissions.length === 0;
  }],

  // 8. Empty/absent input degrades safely.
  ["empty-safe", () => {
    return candorSignals("") === null && candorSignals(null) === null;
  }],
];

let pass = 0, fail = 0;
for (const [name, fn] of cases) {
  let ok = false, err = null;
  try { ok = !!fn(); } catch (e) { err = e.message; }
  if (ok) pass++; else fail++;
  console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : " -> " + (err || "assertion false")));
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
