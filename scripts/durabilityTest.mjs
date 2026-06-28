// Offline regression for the qualitative→quant wiring, where the filing's own words are brought to
// the number so a judgment reads the record and the company's language together. Two wirings:
//   pricingReconciliation — pricing words against the operating-margin trajectory (the moat's
//     defining question). Matrix: (margin direction) × (what the words claim).
//   earningsQualityReconciliation — integrity admissions and non-GAAP steering against the
//     cash-backing ratio (is the reported profit real). Matrix: (cash-backing) × (what the words admit).
// Both corroborate when they agree, explain when the words explain the number, surface tension when
// they disagree, and withhold when there is no signal so the number stands alone. Run with `npm test`.
import { pricingReconciliation, registerReconciliation } from "../src/lib/durability.mjs";
import { earningsQualityReconciliation, normalizedTrend } from "../src/lib/fundamentals.mjs";

let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? "ok   " : "FAIL ") + name); cond ? pass++ : fail++; };

const UP = 0.05, FLAT = 0.0, DOWN = -0.05;  // operating-margin deltas, first→last year

// Withhold when there is nothing to reconcile: the number must stand on its own.
check("no pricing object → no tie", pricingReconciliation(UP, null) === null);
check("no margin delta → no tie", pricingReconciliation(null, { power: "x" }) === null);
check("pricing object with no signal → no tie", pricingReconciliation(UP, { power: null, pressure: null, costInflation: null }) === null);

// The strongest form — a price increase that held its volume — and whether the margin matched.
const strong = { power: "price rose, volume held", powerStrong: true };
const sUp = pricingReconciliation(UP, strong);
check("powerStrong + margin up → corroborates (good)", sUp?.tone === "good" && /confirm/i.test(sUp.text));
const sDown = pricingReconciliation(DOWN, strong);
check("powerStrong + margin down → honest tension (info, not good)", sDown?.tone === "info" && /claim leads the record|not widened/i.test(sDown.text));

// Pricing power claimed and not contested.
const power = { power: "we raised prices", powerStrong: false };
check("power + margin up → agree (good)", pricingReconciliation(UP, power)?.tone === "good");
const pDown = pricingReconciliation(DOWN, power);
check("power + margin down → claim outruns result (info)", pDown?.tone === "info" && /outruns/i.test(pDown.text));

// Pricing power claimed but the same filing also names price competition — contested.
const contested = { power: "we raised prices", pressure: "intense price competition", powerStrong: false };
check("power+pressure (contested) + margin down → pressure winning (warn)", pricingReconciliation(DOWN, contested)?.tone === "warn");
const cUp = pricingReconciliation(UP, contested);
check("power+pressure (contested) + margin up → real yet contested (ok)", cUp?.tone === "ok" && /contested/i.test(cUp.text));

// No claim of power, only price competition named.
const pressure = { power: null, pressure: "price competition forced lower prices" };
const prDown = pricingReconciliation(DOWN, pressure);
check("pressure only + margin down → words explain the slip (warn)", prDown?.tone === "warn" && /take its price/i.test(prDown.text));
check("pressure only + margin up → gain came from elsewhere (info)", pricingReconciliation(UP, pressure)?.tone === "info");
check("pressure only + margin flat → pressure present (warn)", pricingReconciliation(FLAT, pressure)?.tone === "warn");

// No pricing-power signal either way: fall back to the cost pass-through, the margin-durability complement.
check("cost passed through + margin not down → consistent (good)",
  pricingReconciliation(UP, { power: null, pressure: null, costInflation: "input costs rose", passedThrough: true })?.tone === "good");
check("cost not passed through + margin down → where margin compressed (warn)",
  pricingReconciliation(DOWN, { power: null, pressure: null, costInflation: "input costs rose", passedThrough: false })?.tone === "warn");
check("cost passed through but margin down → no false-positive tie",
  pricingReconciliation(DOWN, { power: null, pressure: null, costInflation: "input costs rose", passedThrough: true }) === null);

// ---- earningsQualityReconciliation: integrity & non-GAAP steering against the cash-backing ratio ----

// Withhold when there is nothing to add: the ratio stands on its own.
check("EQ: no language → no tie", earningsQualityReconciliation("good", null) === null);
check("EQ: clean filing, light non-GAAP → no tie", earningsQualityReconciliation("warn", { adjusted: 1.0, materialWeakness: false, restatement: false }) === null);

// The gravest admissions outrank everything, whatever the ratio says.
const mw = earningsQualityReconciliation("good", { adjusted: 0, materialWeakness: true, restatement: false });
check("EQ: material weakness → gravest (bad), even with good cash-backing", mw?.tone === "bad" && /material weakness/i.test(mw.text));
const rs = earningsQualityReconciliation("good", { adjusted: 0, materialWeakness: false, restatement: true });
check("EQ: restatement → warn, numbers have moved", rs?.tone === "warn" && /restat/i.test(rs.text));
check("EQ: material weakness outranks a restatement", /material weakness/i.test(earningsQualityReconciliation("warn", { materialWeakness: true, restatement: true }).text));

// Heavy non-GAAP steering, read against whether cash backs the GAAP profit.
const steerThin = earningsQualityReconciliation("warn", { adjusted: 6.0, materialWeakness: false, restatement: false });
check("EQ: heavy non-GAAP + thin cash-backing → compounding worry (warn)", steerThin?.tone === "warn" && /not backing it|reconciliation/i.test(steerThin.text));
const steerBacked = earningsQualityReconciliation("good", { adjusted: 6.0, materialWeakness: false, restatement: false });
check("EQ: heavy non-GAAP + cash-backed GAAP → tension the cash resolves (ok)", steerBacked?.tone === "ok" && /not papering over/i.test(steerBacked.text));
check("EQ: heavy non-GAAP at the threshold (4.8) fires", earningsQualityReconciliation("warn", { adjusted: 4.8 })?.tone === "warn");
check("EQ: just-below-threshold non-GAAP withholds", earningsQualityReconciliation("warn", { adjusted: 4.7 }) === null);
check("EQ: heavy non-GAAP but middling cash-backing (ok) → withhold (no false flag)", earningsQualityReconciliation("ok", { adjusted: 6.0 }) === null);

// The financial path: no cash-conversion ratio and no non-GAAP lens, so the caller passes
// qualityTone "none" and no adjusted density — only the integrity admission may speak (the honesty
// test that comes before any ratio for a bank, insurer or REIT).
const finMw = earningsQualityReconciliation("none", { adjusted: null, materialWeakness: true, restatement: false });
check("EQ(financial): material weakness speaks with no ratio and no non-GAAP (bad)", finMw?.tone === "bad" && /material weakness/i.test(finMw.text));
check("EQ(financial): restatement speaks with no ratio (warn)", earningsQualityReconciliation("none", { adjusted: null, materialWeakness: false, restatement: true })?.tone === "warn");
check("EQ(financial): a clean financial filing adds nothing", earningsQualityReconciliation("none", { adjusted: null, materialWeakness: false, restatement: false }) === null);
check("EQ(financial): the non-GAAP branch never fires without an adjusted density", earningsQualityReconciliation("none", { adjusted: null, materialWeakness: false, restatement: false }) === null);

// ---- registerReconciliation: the language register (owner vs promoter) against the record's trajectory ----

// Withhold unless one register clearly dominates: the mixed and unremarkable middle gets no character.
const OWNER = { owner: 3.2, promo: 0.2 };   // heavy owner-talk, light promoter-talk
const PROMO = { owner: 1.0, promo: 1.2 };   // heavy promoter-talk, light owner-talk
check("REG: no candor → no read", registerReconciliation("compounding", null) === null);
check("REG: no trajectory → no read", registerReconciliation(null, OWNER) === null);
check("REG: high in both registers → withhold (mixed)", registerReconciliation("fading", { owner: 3.2, promo: 1.2 }) === null);
check("REG: low in both → withhold (unremarkable)", registerReconciliation("fading", { owner: 1.0, promo: 0.2 }) === null);

// A promoter's vocabulary, read against the record — Munger's tell sharpens when returns are fading.
const promoFade = registerReconciliation("fading", PROMO);
check("REG: promoter + fading → the gap to weigh (warn, Promotional)", promoFade?.tone === "warn" && promoFade.value === "Promotional" && /sell harder than the results/i.test(promoFade.text));
check("REG: promoter + compounding → results back the talk (info)", registerReconciliation("compounding", PROMO)?.tone === "info");
check("REG: promoter + holding → words doing the numbers' work (info)", registerReconciliation("holding", PROMO)?.tone === "info");

// An owner's vocabulary, read against the record.
const ownerComp = registerReconciliation("compounding", OWNER);
check("REG: owner + compounding → register and record agree (good, Owner’s terms)", ownerComp?.tone === "good" && ownerComp.value === "Owner’s terms");
check("REG: owner + fading → candor about a hard stretch (ok)", registerReconciliation("fading", OWNER)?.tone === "ok");
check("REG: owner + holding → words and results of a piece (ok)", registerReconciliation("holding", OWNER)?.tone === "ok");

// The thresholds are the catalog's top decile (owner 2.9, promoter 0.8).
check("REG: owner just below 2.9 with low promoter → withhold", registerReconciliation("compounding", { owner: 2.8, promo: 0.2 }) === null);
check("REG: promoter just below 0.8 with low owner → withhold", registerReconciliation("fading", { owner: 1.0, promo: 0.7 }) === null);

// normalizedTrend — read margins through the cycle, not on two endpoints (the GBM normalization).
const NT = normalizedTrend;
// The endpoint trap: first year a peak, last year a trough, but the business is flat. Naive last−first
// would read −8 points ("falling"); the averaged ends read flat. This is the whole point.
check("NT: endpoint trap reads flat, not falling", NT([0.25, 0.18, 0.19, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.17]).direction === "flat");
// A genuine structural decline still reads down.
check("NT: structural decline reads down", NT([0.30, 0.29, 0.28, 0.25, 0.22, 0.20, 0.18, 0.16, 0.15, 0.14]).direction === "down");
// A cyclical trough the latest year recovered from: recent average is dragged down, but it's flagged
// cyclical and read flat, not a one-way slide.
{
  const c = NT([0.20, 0.21, 0.20, 0.21, 0.20, 0.20, 0.08, 0.10, 0.21, 0.22]);
  check("NT: cyclical trough flagged, not called down", c.cyclical === true && c.direction === "flat");
}
check("NT: a real rise reads up", NT([0.10, 0.11, 0.12, 0.14, 0.16, 0.18, 0.20, 0.22, 0.24, 0.25]).direction === "up");
// Thin-margin honesty: a 4%→2% halving is under the 2-point absolute band but large as a fraction of the
// level, so it reads down, not "steady" — and a one-point drift on a fat 40% margin is NOT over-read.
check("NT: thin-margin halving reads down (relative materiality)", NT([0.04, 0.04, 0.04, 0.04, 0.04, 0.03, 0.03, 0.025, 0.022, 0.020]).direction === "down");
check("NT: a 1-point drift on a fat margin stays flat", NT([0.40, 0.40, 0.40, 0.40, 0.40, 0.39, 0.39, 0.395, 0.39, 0.39]).direction === "flat");
// The through-cycle median is the representative level.
check("NT: level is the through-cycle median", NT([0.10, 0.20, 0.30, 0.20, 0.20]).level === 0.20);
// Data-availability: window adapts and never overlaps (decade → 3-yr ends; half-decade → 2-yr ends).
check("NT: 10-year record uses 3-year ends", NT(Array(10).fill(0.2)).window === 3);
check("NT: 4-year record uses non-overlapping 2-year ends", NT([0.30, 0.28, 0.10, 0.12]).window === 2);
// Too short to call a trend (3 yrs): a level, but no direction — never falls back to endpoints.
{
  const s = NT([0.20, 0.18, 0.22]);
  check("NT: 3-year record gives a level but no direction", s.direction === null && s.level === 0.20 && s.n === 3);
}
check("NT: under three years → null (cannot normalize)", NT([0.20, 0.18]) === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
