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
const t = (name, input, expectChangedKeys, cover) => {
  const out = normalizeShareScale(input, cover);
  const changed = Object.keys(input).filter((k) => out[k] !== input[k]).sort();
  const want = [...expectChangedKeys].sort();
  const ok = JSON.stringify(changed) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`✗ ${name}: changed [${changed}] wanted [${want}]`); }
  else console.log(`ok ${name}`);
};

// ConocoPhillips, verbatim from companyfacts — the case that killed majority voting: TEN
// consecutive years tagged in thousands (the MAJORITY of the record), FY2009 tagged ×1000 HIGH,
// correct units years on both ends. The filer's own cover counts arbitrate every year. Also the
// proof that pass 0 corrects BOTH directions per year.
t("conoco-zoo-with-cover-counts",
  { 2007: 1.646e9, 2008: 1.523e9, 2009: 1.498e12, 2010: 1.491e6, 2011: 1.387e6, 2012: 1.253e6, 2013: 1.24e6, 2014: 1.246e6, 2015: 1.242e6, 2016: 1.245e6, 2017: 1.221e6, 2018: 1.176e6, 2019: 1.124e6, 2020: 1.078e9, 2021: 1.328e9, 2022: 1.278e9, 2023: 1.206e9, 2024: 1.181e9, 2025: 1.253e9 },
  ["2009", "2010", "2011", "2012", "2013", "2014", "2015", "2016", "2017", "2018", "2019"],
  { 2007: 1.62e9, 2008: 1.5e9, 2009: 1.49e9, 2010: 1.43e9, 2011: 1.33e9, 2012: 1.22e9, 2013: 1.22e9, 2014: 1.23e9, 2015: 1.24e9, 2016: 1.24e9, 2017: 1.2e9, 2018: 1.15e9, 2019: 1.1e9, 2020: 1.07e9, 2021: 1.3e9, 2022: 1.26e9, 2023: 1.19e9, 2024: 1.17e9, 2025: 1.24e9 });
// A genuine pre-SPAC count whose own year has NO cover fact (the shell hadn't filed): falls to the
// conservative passes, edge stays as-filed even though LATER covers exist.
t("brcc-cover-absent-for-shell-year", { 2019: 1.09e5, 2021: 9.27e7, 2022: 9.5e7, 2023: 9.6e7 }, [], { 2021: 2.1e8, 2022: 2.1e8, 2023: 2.12e8 });
// A cover count that disagrees by a non-thousandfold factor arbitrates nothing (5× trust boundary).
t("cover-disagrees-oddly-refuses", { 2020: 4.2e7, 2021: 4.3e6, 2022: 4.3e7 }, [], { 2021: 4.3e7 });

// The CI identity-baseline gate blocked the first full-pool refetch with 47 NEW breaks — records
// the ORIGINAL max-anchored rule normalized correctly that the class-quantized redesign refused
// (a class boundary at ~31.6M splits legitimate neighbors like 29.7M | 35.6M). These freeze that
// lesson: a CORROBORATED maximum (a second year within ~31.6× of it, max within a step of the
// median) is a trustworthy anchor; an uncorroborated one never is.
t("mcdonalds-switched-to-millions", { 2016: 8.2e8, 2017: 8.1e8, 2018: 7.9e8, 2019: 7.7e8, 2020: 7.5e8, 2021: 7.52e2, 2022: 7.4e2, 2023: 7.3e2, 2024: 7.2e2, 2025: 7.2e2 }, ["2021", "2022", "2023", "2024", "2025"]);
t("conoco-interior-thousands-near-boundary", { 2018: 1.16e9, 2019: 1.12e6, 2020: 1.08e9, 2021: 1.3e9 }, ["2019"]);
t("aiot-v-straddling-31.6M", { 2019: 2.9e7, 2020: 2.97e7, 2021: 3.46e4, 2022: 3.56e7, 2023: 3.6e7 }, ["2021"]);
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
