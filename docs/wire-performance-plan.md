# Wire performance line + per-filing company refresh — implementation plan

Designed 2026-07-09 on the owner's direction: replace the wire's "new language vs. a year ago"
sentence-diff with the established drivers pattern — "performance was up/down X% driven by XYZ"
— and make filings light up their company pages the same day. Full agent proposal follows;
implementation is queued behind the valuation-review PRs.

## Summary

- Replace `whatChanged` on 10-K/10-Q wire items with `performance: { period, basis, rev: {yoy,
  cur, prior}, oi: {yoy, cur, prior}, driver, driverLine, check }` — the percentages COMPUTED
  from the filing's own XBRL (the new accession carries its own prior-year comparative, so both
  numbers trace to the just-filed document), the driver clause verbatim MD&A shipped only when
  it passes the same anchored/directed/figure-verified gates the company pages' Drivers use.
- Measured companyfacts lag: hours, not days (filings accepted 16:00 ET were in companyfacts by
  ~08:16 UTC next morning; wire runs 11:00 UTC) — rung-4 fallback (retry next run while item is
  ≤5 days old) covers the residual.
- Same fetch count as today per periodic filing (1 primary doc + 1 companyfacts JSON vs today's
  2 primary docs); less CPU (regex gates vs full-document Jaccard diff).
- Per-filing refresh: three new wire.yml steps — extract 10-K/10-Q filers from the last 2 days
  of wire.json, run `ONLY_FUND=<tickers> npm run fetch:fundamentals` (merge-over-last-good,
  already supported) + the three audits, add fundamentals.json to the commit. Typical day +1-2
  min; the wire item and the lit-up company page go live in the same deploy. Optional: also
  refresh segments/drivers for 10-K filers (continue-on-error) so the Drivers section lights up
  on filing day.

## Implementation steps

1. Extract shared driver machinery into `src/lib/drivers.mjs` (from scripts/fetchDrivers.mjs,
   verbatim: decode/toBlocks, splitSentences, the gates, yearOk, verifyFigure, directionAgrees,
   withCause, CONSOLIDATED). Two changes while moving: parameterize `mdnaText(blocks, form)`
   (add 10-Q Item 2 anchors mirroring fetchWire's getMDNA; min-length 4,000 for 10-K, ~2,500
   for 10-Q) and refactor `pickConsolidated(sents, { fy, changes })` so callers supply the XBRL
   changes (fetchDrivers builds them from history exactly as today — zero behavior change for
   the 552; fetchWire builds them from companyfacts for the filed period).
2. Export `annualByYear`, `deriveOpInc`, and a new `revenueTagsFor(sic)` from
   fetchFundamentals.mjs (quarterFlowMap and latestObservation are already exported).
3. Replace `whatChanged()` in fetchWire.mjs with `performanceFor(c, r, i)`:
   companyfacts fetch → 10-K: annualByYear cur/prior (end within ±20d of reportDate − 1y);
   10-Q: quarterFlowMap cur/prior, YTD-duration fallback (`basis: "ytd"`); primary-doc fetch
   (already paid today) → mdnaText → pickConsolidated → first verified clause, revenue anchor
   preferred. Delete priorYoYIndex + the prior-year doc fetch + the diff import. Cache
   `cache[accn] = performance`; treat cached null as a miss while item.date ≥ today − 5d.
   A pct ships only when prior > 0 for that line — silence over filler.
4. wire.astro: replace the "New language vs. a year ago" block with the performance line
   ("Revenue up 12.3% year over year; operating income up 9.0%"), the verbatim driver
   blockquote when present, and the provenance note ("figures computed from the filing's XBRL;
   the words are the company's"). No adjectives, no beat/missed, no em-dashes.
5. sendWire.mjs: one indented numbers-only line under periodic items (the clause stays on the
   wire page).
6. wire.yml: the three per-filing-refresh steps (filers extraction over a 2-day window → two
   attempts per filer, self-heals the same-morning XBRL edge; ONLY_FUND fetch; audits) and add
   fundamentals.json to the commit step.

## Fallback ladder

1. XBRL present + clause verifies → numbers + verbatim clause.
2. XBRL present, no clause passes → numbers only (fully doctrine-clean).
3. One metric only proves (prior ≤ 0 or untagged) → that line alone.
4. XBRL missing at 11:00 UTC → performance null, retryable next run (measured: rare).
5. REJECTED: clause without computed numbers (nothing to verify direction/figure against);
   R-file/exhibit parsing (fragile). Documented option if lag ever proves real: parse the
   already-fetched primary doc's inline XBRL (ix:nonFraction; zero extra fetches).

## Verification plan

1. Fixture test `scripts/wirePerfTest.mjs` in npm test: 10-Q MD&A excerpts + hand-built
   changes; assert mdnaText finds the section, pickConsolidated verifies, and a six-month
   sentence is rejected against quarter changes. Assert fetchDrivers' 10-K path byte-identical
   pre/post refactor (ONLY_TICKERS=AAON,NVDA diff of drivers.json entries).
2. Live dry-run: clear cached periodic items, run fetchWire locally, hand-verify pcts against
   companyfacts and each clause's narrated figure.
3. Build + email dispatch (window_days knob) — inspect /wire and both email formats.
4. Per-filing refresh: workflow_dispatch on a filing day; confirm filers step, fundamentals
   diff touches only those companies, audits green, /c/<ticker> shows the new quarter in the
   same deploy as the wire item.
5. One-week lag probe: log per periodic filing whether companyfacts had the period at run time.

Key files: scripts/fetchWire.mjs, scripts/fetchDrivers.mjs, scripts/fetchFundamentals.mjs
(exports only), new src/lib/drivers.mjs, src/pages/wire.astro, scripts/sendWire.mjs,
.github/workflows/wire.yml.
