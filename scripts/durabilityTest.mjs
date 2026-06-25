// Offline regression for the qualitative→quant wiring, where the filing's own words are brought to
// the number so a judgment reads the record and the company's language together. Two wirings:
//   pricingReconciliation — pricing words against the operating-margin trajectory (the moat's
//     defining question). Matrix: (margin direction) × (what the words claim).
//   earningsQualityReconciliation — integrity admissions and non-GAAP steering against the
//     cash-backing ratio (is the reported profit real). Matrix: (cash-backing) × (what the words admit).
// Both corroborate when they agree, explain when the words explain the number, surface tension when
// they disagree, and withhold when there is no signal so the number stands alone. Run with `npm test`.
import { pricingReconciliation } from "../src/lib/durability.mjs";
import { earningsQualityReconciliation } from "../src/lib/fundamentals.mjs";

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
