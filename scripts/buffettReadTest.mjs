// Offline regression test for buffettRead, the routine that surfaces the handful of things Buffett
// and Munger actually hunt for in a 10-K: demonstrated pricing power vs. price-taking, whether input
// costs were passed through, where the reported numbers rest on management's judgment (the critical
// accounting estimates), and the grave integrity admissions (material weakness, restatement). It runs
// no network: each case is a small set of synthetic Business/MD&A/Risk sentences faithful to real 10-K
// phrasing, and an assertion over the structured read. Guards the hard cases — a conditional risk
// "if we cannot raise prices" that must NOT read as pricing power, a clean "we did not identify any
// material weakness" that must NOT trip the flag, a negated "unable to fully offset" that must NOT
// read as passed-through. Run with `npm test`.
import { buffettRead } from "./fetchFilings.mjs";

// Build a filing object shaped like getFiling's output (only the sentence arrays the read uses).
const mk = ({ mdna = [], biz = [], risk = [] }) => ({ mdna: { sents: mdna }, business: { sents: biz }, risk: { sents: risk } });

// A critical-accounting-estimates block, padded with lead-in sentences so the heading sits past the
// 25% mark of the MD&A (where the real section lives, not a table-of-contents reference).
const critBlock = [
  "Net sales increased during the period across our reportable segments.",
  "Operating income reflected higher volumes and disciplined cost control.",
  "Liquidity remained strong with cash on hand and available credit.",
  "We returned capital to shareholders through dividends and repurchases.",
  "Critical Accounting Estimates The preparation of our financial statements requires management to make estimates and assumptions.",
  "We test goodwill for impairment annually and assess intangible assets for indicators of impairment.",
  "Revenue recognition requires judgment in identifying performance obligations and allocating the transaction price.",
  "Pension and postretirement benefit obligations depend on the expected long-term rate of return on plan assets and the discount rate.",
  "Income taxes require estimates of our valuation allowance and unrecognized tax benefits for uncertain tax positions.",
];

const cases = [
  // 1. Demonstrated pricing power: declarative price increases tied to a result. Power set, no pressure.
  ["pricing-power", mk({
    mdna: [
      "Net sales increased 8% during fiscal 2025, driven primarily by higher pricing across all of our segments.",
      "We implemented list price increases in the second quarter to reflect the value of our brands.",
    ],
  }), (r) => r?.pricing?.power && !r.pricing.pressure && r.pricing.powerCount >= 1],

  // 2. Price-taker: intense competition forced price cuts. Pressure set, power null.
  ["pricing-pressure", mk({
    mdna: [
      "We faced intense price competition during the year and were forced to lower prices on several key product lines to retain volume.",
    ],
  }), (r) => r?.pricing?.pressure && !r.pricing.power],

  // 3. Cost inflation passed through: pricing actions recovered higher input costs. passedThrough true.
  ["cost-passed", mk({
    mdna: [
      "Higher raw material and freight costs during the year were largely offset by pricing actions taken to recover these increases.",
    ],
  }), (r) => r?.pricing?.costInflation && r.pricing.passedThrough === true],

  // 4. Cost inflation NOT passed through: the negated-offset trap. costInflation set, passedThrough false.
  ["cost-squeezed", mk({
    mdna: [
      "Rising input and labor costs pressured our margins during the period, which we were unable to fully offset with pricing.",
    ],
  }), (r) => r?.pricing?.costInflation && r.pricing.passedThrough === false],

  // 5. Critical accounting estimates: four judgment-heavy topics named in the section. Topics + count.
  ["critical-estimates", mk({ mdna: critBlock }),
    (r) => r?.judgment && r.judgment.count >= 4 &&
      ["Goodwill & intangibles", "Revenue recognition", "Pension & retirement", "Income taxes"].every((t) => r.judgment.topics.includes(t))],

  // 6. Material weakness ADMITTED: declarative, in internal control over financial reporting. Flag set.
  ["material-weakness", mk({
    risk: [
      "During 2025, we identified a material weakness in our internal control over financial reporting related to our revenue recognition process.",
    ],
  }), (r) => r?.integrity?.materialWeakness],

  // 7. Material weakness ABSENT (clean filer): the routine negation must NOT trip the flag.
  ["material-weakness-clean", mk({
    mdna: critBlock,
    risk: [
      "Management concluded that our internal control over financial reporting was effective, and we did not identify any material weakness.",
    ],
  }), (r) => !r?.integrity],

  // 8. Restatement ADMITTED: declarative past tense. Flag set.
  ["restatement", mk({
    mdna: [
      "We restated our previously issued consolidated financial statements for fiscal 2023 and 2024 to correct an error in the timing of revenue.",
    ],
  }), (r) => r?.integrity?.restatement],

  // 9. Restatement HYPOTHETICAL (clean): a risk-factor "if we are required to restate" must NOT trip.
  ["restatement-hypothetical", mk({
    mdna: critBlock,
    risk: [
      "If we are required to restate our financial statements in the future, investors may lose confidence and our stock price could decline.",
    ],
  }), (r) => !r?.integrity],

  // 10. Pricing-power HYPOTHETICAL guard: a conditional "if we cannot raise prices" is a risk, not
  // evidence of pricing power. Power must be null even though the words "raise prices" appear.
  ["pricing-hypothetical", mk({
    mdna: [
      "If we are unable to raise prices to offset rising costs, our operating margins could decline materially.",
    ],
  }), (r) => !r?.pricing?.power],

  // 11. A clean, plain filing trips nothing: no pricing claim, no critical-estimates section, no
  // integrity admission. The read returns null rather than manufacturing a signal.
  ["silent", mk({
    mdna: ["The company operates in a single reportable segment and serves customers in North America."],
    biz: ["We provide logistics services to commercial customers."],
  }), (r) => r === null],
];

let pass = 0, fail = 0;
for (const [name, cur, want] of cases) {
  const got = buffettRead(cur);
  const ok = !!want(got);
  console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : " -> " + JSON.stringify(got)));
  ok ? pass++ : fail++;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
