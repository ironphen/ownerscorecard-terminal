#!/usr/bin/env node
// shareScaleTest.mjs — the share-scale normalizer's case law, frozen (docs/correctness-campaign.md N8).
//
// Every case here is a real filer pattern that was verified against EDGAR during the Wave-2
// adversarial review, and each encodes a decision that MUST NOT drift:
//   - Amerant (single year and a 3-year RUN tagged in thousands, bounded both sides): corrected.
//   - Box (one interior year in thousands): corrected.
//   - BRCC (genuine pre-SPAC 109k count at the record's EDGE): as-filed — correcting as-filed
//     truth is worse than the seam; the audit flags it for the filing re-read.
//   - Fresenius (FIRST year tagged ×1000 HIGH): as-filed — under the old Math.max-anchored rule
//     this year became the reference and the whole correct record was scaled UP toward it,
//     silently corrupting 69 ADR names while erasing the audit signal. Never again.
//   - Banco Bradesco (bogus ×1000-HIGH instant filling the LAST year): as-filed, same lesson.
//   - Freedom Holding (interior runs tagged ×1000 HIGH against a correct majority): corrected DOWN.
//   - No strict majority scale: refuse to guess, everything as-filed.
//   - A 100× discrepancy (not a 1000-step mistag): as-filed — ×1000 steps land nowhere near.
import { normalizeShareScale, majorityShareRef } from "../src/lib/shareScale.mjs";

let failed = 0;
const t = (name, input, expectChangedKeys) => {
  const out = normalizeShareScale(input);
  const changed = Object.keys(input).filter((k) => out[k] !== input[k]).sort();
  const want = [...expectChangedKeys].sort();
  const ok = JSON.stringify(changed) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`✗ ${name}: changed [${changed}] wanted [${want}]`); }
  else console.log(`ok ${name}`);
};

t("amerant-single-thousands-year", { 2016: 4.2e7, 2017: 4.25e7, 2018: 4.25e7, 2019: 4.29e4, 2020: 4.17e7, 2021: 4.1e7 }, ["2019"]);
t("amerant-bounded-run", { 2016: 4.2e7, 2017: 4.25e4, 2018: 4.25e4, 2019: 4.29e4, 2020: 4.17e7, 2021: 4.1e7, 2022: 4.1e7 }, ["2017", "2018", "2019"]);
t("box-interior-year", { 2018: 1.4e8, 2019: 1.45e8, 2020: 1.48e8, 2021: 1.56e5, 2022: 1.56e8, 2023: 1.5e8 }, ["2021"]);
t("brcc-genuine-edge-low", { 2019: 1.09e5, 2021: 9.27e7, 2022: 9.5e7, 2023: 9.6e7 }, []);
t("brcc-genuine-edge-run", { 2019: 1.09e5, 2020: 1.2e5, 2021: 9.27e7, 2022: 9.5e7, 2023: 9.6e7, 2024: 9.7e7 }, []);
t("fresenius-first-year-high", { 2016: 3.06e11, 2017: 3.07e8, 2018: 3.07e8, 2019: 2.91e8, 2020: 2.93e8, 2025: 2.9e8 }, []);
t("bradesco-last-year-high", { 2015: 3.3e9, 2016: 3.4e9, 2020: 4.5e9, 2024: 5.3e9, 2025: 1.06e13 }, []);
t("freedom-interior-high-runs", { 2017: 3.3e7, 2018: 3.34e10, 2019: 5.82e10, 2020: 5.83e10, 2021: 5.9e7, 2022: 5.9e7, 2023: 5.9e7, 2024: 5.94e10, 2025: 6e7 }, ["2018", "2019", "2020", "2024"]);
t("ordinary-growth-untouched", { 2016: 5.5e9, 2017: 5.25e9, 2018: 2.0e10, 2019: 1.86e10, 2020: 1.75e10 }, []);
t("no-majority-refuses", { 2016: 1e5, 2017: 1e8, 2018: 1e11 }, []);
t("hundredfold-not-a-mistag", { 2016: 4.2e7, 2017: 4.2e5, 2018: 4.3e7, 2019: 4.2e7 }, []);

// majorityShareRef: the reference must be the majority-class median, never the maximum — a single
// mistagged-HIGH year must not become the scale the current count is corrected toward.
const ref = majorityShareRef({ 2016: 3.06e11, 2017: 3.07e8, 2018: 3.07e8, 2019: 2.91e8, 2020: 2.93e8 });
if (!(ref != null && ref > 2.9e8 && ref < 3.1e8)) { failed++; console.error(`✗ majorityShareRef: got ${ref}, wanted the ~3e8 median, not the 3.06e11 outlier`); }
else console.log("ok majority-ref-ignores-high-outlier");
if (majorityShareRef({ 2016: 1e5, 2017: 1e8, 2018: 1e11 }) !== null) { failed++; console.error("✗ majorityShareRef: no strict majority must return null"); }
else console.log("ok majority-ref-refuses-without-majority");

if (failed) { console.error(`\n❌ shareScaleTest: ${failed} failure(s).`); process.exit(1); }
console.log(`\n✅ shareScaleTest passed.`);
