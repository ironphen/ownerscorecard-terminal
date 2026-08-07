# The Owner-Earnings Bridge Survey — acquired-intangible amortization, the seam, and the wear basis

Ruling record, 2026-08-07. Nine-agent survey (8 lanes + synthesis, ~1.0M tokens of probes;
full evidence in the workflow output, journal at
`subagents/workflows/wf_0fe97578-517/journal.jsonl`). Successor program to solvency-sight;
ranked #1 by the 2026-08-06 next-frontier census. Prerequisite fixes already shipped:
the instant tie gate + ROP capex ladder (1115aed).

## The defect, in three classes (all live, ordered by wrongness)

One root: `lines.depreciation` is a 7-rung bundled-first ladder (fetchFundamentals.mjs:131)
merged per-year first-tag-wins with tag provenance discarded, feeding a bridge residual
(`other = CFO − NI − dep − SBC`, fundamentals.mjs:667) that closes any error by construction
under the label "timing of cash in and out."

1. **SCALE.** /c/COHR renders a **+$681.7B** D&A add-back and −$680.9B "Working capital &
   other" on a ~$5B-revenue filer. Coherent files `DepreciationAndAmortization` at exactly
   1000× (FY2023 681,687M; FY2024 559,761M; FY2025 553.6M correct), and its own component
   tags convict it: 267.6M + 414.1M = 681.7M. The ladder serves it because COHR files no
   higher rung. Same class as the DJCO 2012-13 watch item.
2. **SEAM.** When a filer retires its bundled tag, the per-year merge splices tag
   generations into one series. DHR: DDA died with the FY2023 10-K (2,166M); rung-7
   `Depreciation` (721M) filled FY2024+ — a 3× collapse rendered as real, while
   dep + amort = DDA ties TO THE DOLLAR in all 9 overlap years 2015-2023 (675+1,491=2,166).
   Consequences on the live page: ~$1.6B of amortization relabeled "timing of cash in and
   out"; maintenance flipped from full capex ($1,383M) to dep ($721M) on an unchanged test;
   the chip reads "1.54× Expanding" (0.47× on the bundled basis); and the rendered OE trend
   says OE ROSE FY2023→FY2024 when on EITHER uniform basis it FELL — the seam inverts the
   direction of the flagship number. Same live shape: RRX (492.8→165.3M, parts tie exact),
   FISV (3.16B→589M), TMO FY2018→19 inside today's ten-year window; ELV, AON adjacent.
   Plus a tag-switch-INVISIBLE class: MRSH's DDA silently re-scoped mid-record (FY2019-21
   DDA = dep+amort exact; FY2022-25 DDA == Depreciation exact with amort 549M tagged
   beside) — 24 pool filers show bundle==dep-exact-with-amort>0 in CY2024 (MSCI, SAIC,
   CACI, BBY 866M vs 21M...).
3. **LABEL + BASIS.** AVGO's bridge adds back $574-593M under the label "Depreciation &
   amortization" while filed amortization is $9.27B (FY2024, 158% of NI) — the label is
   false and the economics unnamed. And the pool ALREADY runs two wear bases under one
   key by tagging dialect alone: 242 MSFT-shape filers (no bundled tag ever) get
   property-only depreciation via rung-7 fall-through, while DHR-shape filers get bundled —
   635 of 2,473 capex+dep filers currently charge bundled D&A as maintenance.

## Census numbers (frames CY2023∪CY2024 ∩ pool, 2,892 CIKs)

- AmortizationOfIntangibleAssets: 1,875 in-pool. Separate property dep (Depreciation ∪
  Nonproduction): 1,867. Bundled family: 2,311. Triple-coexist: 1,177. Amort-without-
  bundled (Class A, two-row-ready): 267. Bundled-only: 384. None: 185 (financials).
- Identity `bundled = dep + amort` on 1,043 triple filers, CY2024: 298 exact to the
  dollar, +304 within 1%, **394 off >2%** (AMZN gap $23.1B; UNH $1.7B) — the untied case
  is COMMON, not corner. Amort share of bundled: p50 25%, p90 79%; 142 filers ≥80%.
- Subset-gate violations (amort > bundled): 47 filers (NDAQ, GPN, TTWO, JAZZ...).
- Seam class: 16 of 52 probed acquirers have ≥1 mid-record picked-tag switch; five live
  in rendered windows (DHR, RRX, FISV, TMO, ELV).
- Dead ladder rungs (frames 404 both years): DepreciationAmortizationAndOther,
  DepreciationDepletionAndAmortizationNonproduction.

## Content-amortization ruling: STANDALONE

Same disease (PP&E-only capital cycle misrepresenting filers whose earning assets amortize
elsewhere), different anatomy in every load-bearing respect: the subset gate can never fire
(NFLX content amortization is 49× its bundled D&A); disjoint tag families (NFLX's content
flows are nflx: extension tags companyfacts does not serve; Film*/EntertainmentLicense*
elements appear in no ladder rung); opposite fix direction (this build NARROWS the wear
line, content WIDENS both sides of the cycle); and the OE dollar is already correct for the
cohort — the misrepresentation is the cycle chip and maintenance stand-in, not the walk.
Content gets its own future survey; NFLX and the media cohort are OUT OF SCOPE for every
build below.

## Canon verdicts (verbatim-verified against berkshirehathaway.com; 2004+ PDFs re-verify before shipping any quote)

AUTHORIZED: the two-row split is Berkshire's own table discipline (1986: "we show our
amortization and other purchase-price adjustment items separately in the table"; 1998:
"aggregated and shown separately... The total earnings we show in the table are, of course,
identical to the GAAP total") — walk-closes-to-the-dollar is literally the precedent. The
acquisitions-panel sentence only with cumAcq at full cost forever (1983: "forever viewing
purchased Goodwill at its full cost, before any amortization").

FORBIDDEN/CONSTRAINED: property depreciation is NEVER added back anywhere (1989 "every bit
as real an expense as labor or utility costs"; 2002 EBITDA "pernicious"; 2014 "Every dime
of depreciation expense we report is a real cost"). And 1986 (c) does NOT cleanly authorize
property-only depreciation as a universal wear basis — verbatim it is "the average annual
amount of capitalized expenditures for plant and equipment, **etc.**" with the See's hedge
($500K-$1M ABOVE depreciation "simply to hold our ground") and "(c) must be a guess."
Any wear re-basing must carry its basis label and the guess-acknowledgment.

## Build order (wrongest first)

**BUILD 1 — COHR scale arbitration.** Where a filer files component tags beside a bundled
candidate, a bundle at ~1000× the parts-sum is convicted by the filer's own arithmetic and
that year serves the parts-consistent value. Conviction ONLY by the filer's own identity —
no unit guessing, no magnitude heuristics vs revenue. Tolerance 1% / $2M floor
(companyfacts carries no decimals field). Diff gate: fundamentals.json changes for COHR
only. Pins: COHR D&A 681.7M/559.8M/553.6M; zero other filer-years altered.

**BUILD 2 — Provenance + net-new intangibleAmortization line (zero value change).**
Per-year winning-tag marker on the depreciation series (equityBasis precedent) — every
later gate is undecidable without provenance. Fetch AmortizationOfIntangibleAssets as a NEW
line. Diff gate: lines.depreciation changes for ZERO filer-years. Source companyfacts,
never companyconcept (measured: companyconcept silently returned empty units for ≥11/119
populated tags). No collision with software CapitalizedContractCostAmortization or
insurance DAC. Pins: DHR amort series; AVGO 9,272M stored with FY2020-22 ABSENT never zero.

**BUILD 3 — Seam gate: family-partitioned stitching + flip-kill.** Partition the ladder:
BUNDLED family (rungs 1-5, minus CoGS-D&A which is component-scoped) vs COMPONENT family
(Depreciation). Within family first-present-per-year; across families NEVER per-year fill.
Where families coexist and amort is tagged: ≥2 coexisting years with the identity tying →
RECONCILED (store per-year parts); else the family owning the latest year IS the series and
the other family's years are withheld with a stated withhold on the bridge — never a silent
null the residual absorbs. Identical gate in the ttm reader or lines/ttm disagree across
the seam. typicalDepToRev backfill becomes family-scoped and must distinguish tag-gap from
gated (the :583 branch defeats withhold-never-guess today). Pins: DHR dep 750/721/675/698/674
+ identity 9/9 + maint FY2024 = full capex 1,392 (flip killed) + OE-trend direction reads
DOWN; RRX 511.8M continuity; FISV 589+2,300=2,889.

**BUILD 4 — Two-row bridge by class, label truth, chip basis label (zero OE change).**
Class A (both parts, no bundled tag ever — AVGO, ABBV, MSFT, GOOGL, IBM, AMD, ADI, GILD;
reconcile the 267-filer and 157-filer censuses into one provenance-based list): two AS-FILED
add-back rows, each labeled by the filer's own concept; gap years render explicit stated
absence. Class B (triple, 1,177): split ONLY in identity-tying years; failing years keep
the bundled row as filed. Walk-closure test shipped (sum of rows === CFO === OE/FCF per
year). Chip labels its denominator basis. Pool-wide OE delta pinned at exactly ZERO —
presentation-only. Pins: AVGO two rows 593/9,272 with residual tie +7,733 exact; DHR
other-row FY2021-23 UNCHANGED (free regression proof).

**BUILD 5 — Acquisitions panel: full-history cumAcq + the amortization sentence.**
cumAcq extended to full concept history (DHR $79.2B; IBM $88.6B; BMY $87.1B). ONE factual
sentence: cumulative acquired-intangible amortization beside cumAcq, consideration-basis
caveat for stock deals (AMD: $281M cash ever vs $24.8B goodwill — Xilinx all-stock; ADI
2021 negative year), coverage disclosure for tag holes. Never divide the two figures.
cumAcq never netted of amortization (1983 verbatim).

**BUILD 6 — Wear re-basing. GATED: ships last, ONLY on owner ratification.** Stand-in =
confirmed-bundled MINUS same-FY amort (identity rule). The bare-Depreciation-tag path is
REFUSED OUTRIGHT: it inflates AMZN OE +32.4% by dropping $23.1B of real non-intangible
amortization the subset gate cannot catch (AAPL +4.8%, UNH +16.3% poisoned identically).
Coverage-continuity gate: any missing amort year withholds the WHOLE record's rebase.
Measured on 119 names: 31 change, ALL upward, median 0.0%, p90 +6.0%, max +13.2% (MDT);
zero sign flips; chip flips 34/119. Monotone-upward by construction — a flattering
restatement of the flagship number across the acquirer cohort — hence the owner call.
Ships only with the full 2,522-filer measurement pinned in the commit.

## Standing refusals (this survey)

- Deriving a missing part by subtraction across declared precisions (dep = bundled − amort)
  — the WPC decimals=-5 lesson; refuse.
- The bare-Depreciation wear basis (the AMZN $23.1B evidence). Refused even if Build 6 is
  ratified.
- companyconcept as an extraction source for these tags (silent empty-units failures).
- Naive exact-equality identity tests (625.1 vs 625.0 is a righteous rounding tie).
- REITs excluded from every build: real-estate bundled D&A is the disputed charge itself,
  a different animal (reits.mjs untouched; TenYear REIT shelf stays as-filed).
- NFLX/content cohort excluded (standalone ruling above).

## Owner questions (open; Builds 1-5 proceed under standing grants)

1. **Ratify or refuse Build 6.** Both endpoints are canon-defensible: stopping at Build 4
   (presentation truth, zero OE change) vs charging only real wear (monotonically
   OE-increasing for acquirers, measured max +13.2%). The direction of error the site
   prefers to live with is an owner call; the pinned measurement will be on the table.
2. **Class-A gap-year rendering:** dashes with stated absence (more truth, visibly
   discontinuous row) vs withholding the whole amort row on incomplete records.

## Thin claims (re-probe before relying)

- AMZN's $23.1B gap composition (asserted "content/lease/other amortization", not
  decomposed from its CF statement — the refusal survives on AAPL/UNH/LMT regardless).
- The 24-filer silent-rescope class beyond MRSH (single-frame inference; each record needs
  a multi-year probe before gating).
- The Build 6 delta beyond the 119-name sample (full re-measurement is the ship gate).
