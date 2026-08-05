# Solvency sight survey — float and HTM marks, the ruling record

*2026-08-05. Nine agent lanes over the real pool and the real code; two adversarial kill lanes;
every claim measured. Full per-lane evidence: session scratchpad survey_lanes.json (wf_0dcdec6a).
This survey was commissioned as "two new frontier desks." Its first finding is that BOTH already
ship — floatOf() with two bases, cost of float, spread over crediting, yield on float, and the
HTM marks check are built, tested, and rendered. The survey therefore rules on something better:
the shipped desks print WRONG figures on the most-watched names in the pool, and the genuinely
new artifacts are the through-cycle records and the SVB same-card read. Wrongest first.*

## THE HEADLINE DEFECTS (live today)

1. **Berkshire's page prints "Float $17.9B." Buffett's own letter states ~$171B.** BRK tags no
   premiumsEarned, lossReserves or unearnedPremiums in ANY of FY2016-2025; only a $17.9B
   futurePolicyBenefits sliver lands, the conglomerate carve-out (archetype.mjs:249) cannot fire
   without premiumsEarned, and floatOf falls through to the life basis. The wrongest float figure
   a Buffett-doctrine site could print, on the float company. Same fall-through class: HIG prints
   $4.8B against $46.3B gross reserves, CINF $3.8B against $11.5B — 6 P&C-SIC rows total.
2. **8 of the top-20 US banks are SILENT on HTM marks for want of one tag generation.** C, USB,
   PNC, BK, STT, CFG, FITB, KEY lost their cost leg to the CECL-era variant
   DebtSecuritiesHeldToMaturityExcludingAccruedInterestAfterAllowanceForCreditLoss (fair-only
   rows climb 11→43 across FY2019-24). Verified on EDGAR: USB cost $76.17B vs fair $67.08B
   (gap $9.1B, ties the filer's own unrecognized-loss tag to the dollar), C gap $10.3B. Stories
   currently untold. COF/AXP/ALLY/SYF genuinely file no HTM book — their silence is correct.
3. **The shipped HTM percentage is neither labeled nor consistent.** BAC prints 34.5% with no
   pre-tax label; the denominator silently changes definition across banks (preferred never
   deducted — WFC would read 23.2% on true tangible common; BAC's ~$28B preferred isn't even
   extracted); 43 of 142 pair-banks lack intangibles tags and get equity-less-goodwill dressed
   as tangible. And the tone ladder prints "Severe if realized" — a verdict whose realized base
   rate inside the pool is zero BY CONSTRUCTION (failed banks deregister; measured: of 48
   warn/bad banks at FY2022, one lost ≥10% of deposits in 2023, zero failed).
4. **costOfFloat divides by year-end float; the letters use the two-year average.** Systematic
   bias, up to 1,078bp on growers (PLMR), −105bp on PGR. 21 of 32 resolved P&C issuers already
   have the consecutive same-basis pair in history.
5. **The reserves-only fallback shows GROSS reserves with a direction note that inverts on
   cedents** (MKL ~55% off), and the 4-term underwriting component subtraction is broken twice
   over — only the filer's own lossesAndExpenses total ties (54/62 exact);
   otherUnderwritingExpense equals its sibling in 19 of 19 occurrences (duplicate mapping).

## BUILD ORDER

**Build 1 — no wrong floats.** Fence Formula B to life-shaped books; a P&C-SIC row failing
Formula A's deduction gates falls to the labeled reserves-only reading or WITHHOLDS — never a
life-basis print. One-line coherence gate: a printed float may never be smaller than the same
filer's gross loss reserves. Fail the conglomerate carve-out closed (no premiumsEarned anywhere
on a 6331 filer → not the insurer scorecard). Stated-float weld primacy: where the filing states
its float in a sentence, quote it verbatim (OwnersRead shape) and withhold the formula figure on
disagreement — Berkshire's page must show Buffett's number or nothing. Fix the fallback to net
reserves (13 of 14 measured names have a net leg) with the direction note conditional.
Canaries: BRK-B never prints $17.9B; HIG never prints $4.8B; PGR/TRV/CB unchanged to the dollar.

**Build 2 — the fourth HTM tag generation** in banksLines.mjs stitch + bank-pool heal. Restores
the cost leg for ~39 rows / 33 CIKs incl. C ($10.3B) and USB ($9.1B). Zero formula risk.
Register any new line in BANK_LINE_NAMES or carry-over resurrects stale values.

**Build 3 — the HTM check made honest.** Signed heading ("HTM: amortized cost − fair value" —
10 banks carry gains); pre-tax stated in the formula line; denominator basis stated per bank
("tangible common" only where preferred is present and netted; tangible column WITHHELD where
intangibles are untagged — missing is not zero, no backfill); strike the verdict tones
("Severe if realized" dies; conditional "if realized" phrasing stays on the presenting side);
suppress on preferred-series pages; as-of date with a rates caveat (or extract the pair into the
quarterly reader — it sits in companyfacts through Q2-2026); the AFS sentence: "Stated equity
already carries every available-for-sale mark through AOCI; the held-to-maturity book is carried
at amortized cost, so its disclosed gap sits outside equity." Record leg where history carries
it: FY2022 the widest year, the accretion strip since (the mark is measured as DURABLE — the
kill lane's accretes-back argument failed; ~26% accreted in 3 years). REFUSED: any after-tax
restatement at an assumed rate (the record holds no bank's deferred-tax position); any ranking
or grading by the figure; the bench column (clears half on 138 of 302 benches — record in
REFUSED_ON_BENCH with digits); the sector table. SIC hygiene: exclude 6199 wholesale (53 crypto
rows), admit the brokers that carry the disclosure (SCHW's $126B book is the 2023 canon), CIK
dedupe (288 issuers, not 337 rows).

**Build 4 — the SVB read on one card.** Mark/TE beside the deposit-franchise leg with its state
explicit: shown uninsured % (weld), the filer's verbatim sentence, "withheld: netted basis"
(BAC's state today), or "no HTM book." Where the weld is withheld, the noninterest-bearing
deposit share from lines is the honest franchise leg. The measured fact that ZERO pool banks
today combine a ≥30% mark with ≥40% uninsured funding is itself the product — the ex-ante
complete denominator, printed. Prose-welded numbers still never feed arithmetic (rung-b ruling
stands until a basis-divergence study).

**Build 5 — cost of float on the two-year average** (the letters' denominator), point-in-time
kept only as a labeled fallback. Both legs same fiscal year, per the existing priorCof rule.

**Build 6 — the through-cycle records (the genuinely new artifact).** Float growth and average
cost of float across the record: computable for 62 issuers with NO new extraction (5-yr for 44).
Two tables, never one: underwriting float (with combined ratio alongside) and spread float
(with crediting spread) — the category-error kill survives against any single sortable column.
CIK-deduped, primaryTicker only, basis label mandatory, sorted by size, nothing graded, no
cost-of-float leaderboard (redundant with CR at half the coverage, and it crowns short-tail
books). The HTM record strip joins from Build 3.

**Build 7 — component-only extraction heals** (zero formula risk): premiumsReceivable
(restores FULL float for AIG, MKL, WRB, ORI + 3 more), reinsuranceRecoverables (ALL, AGO),
dacBalance; the BRK loss-reserves dimensional keyhole with the letter's $171B as acceptance;
quarantine or fix otherUnderwritingExpense. ADR insurers (MFC/SLF/PUK) are an IFRS-17 seam,
named and deferred, not an extraction bug.

## STANDING REFUSALS FROM THE KILL LANES
No grading, ranking, or leaderboards on either figure (arrangement is a pronouncement — and the
tone ladder's harshest word described an event with a zero realized base rate). No after-tax at
an assumed rate. No cross-basis float column. No 4-term underwriting subtraction. No bench
column for HTM. Combined-ratio-kills-float REJECTED in total form (float intensity is real
information CR lacks) but cost-of-float ranking REFUSED as redundant-and-misleading.

## PROVENANCE RULE (both desks)
Figures and welds link language.json's primary-document sourceUrl ("From the FY2025 10-K as
filed"), gated on language fy === fundamentals fy (holds 142/142 and 135/135 today). Never link
fundamentals.sourceUrl unshaped — 115 of 142 bank rows would send the reader to an EDGAR index.
