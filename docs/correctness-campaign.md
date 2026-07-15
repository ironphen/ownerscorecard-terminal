# The correctness campaign

*2026-07-15. The standing mandate: the foreseeable future goes to the quality and
correctness of every company page and every data pipeline. A wrong number is worse
than a missing one; correctness is the product.*

## The shape of the work

Two axes, two roles. **The shelf is the unit of work**: accounting is homogeneous
within a shelf and errors are correlated there — every bug found in July 2026 was
shelf-shaped (lessor SIC 7359 revenue slivers, megabank IFRS gross-vs-net, Diageo
attributable-vs-total). One tag-rule fix repairs a whole cohort. **Revenue is the
priority ordering**: 181 US+ADR names at ≥$50B and 447 at $10–50B are where readers
land first and where a wrong figure costs the most trust; they get first-class
depth, the sub-$2B tail gets sampled plus mechanically swept.

Before choosing an attack order, run cheap universe-wide detectors and let the
error map pick it. Universe at kickoff: 3,870 companies (US 2,878 / ADR 743 /
JP 204 / EU 45), 29 shelves, no orphans.

Rules of engagement:

- Every detector hit is **adversarially verified against the actual filing before
  it counts** — detectors cry wolf (the Safran "2025" string-match, twice).
- Fixes land as **pipeline rules, never hand-edits to committed data**.
- Every fixed bug class gets a **permanent gate** so it cannot recur. The prize is
  not fixing today's errors; it is making them unable to ship.

## The three oracle layers

- **L1 — filing vs published.** Re-read the primary source with *independent*
  selection logic and compare to committed data. Catches tag-choice, period, unit,
  and scale bugs — the dominant observed class. As of kickoff, **nothing in the
  repo qualifies**: every existing check runs the same selection logic (or the same
  src/lib functions) that produced the data it checks. Greenfield.
- **L2 — internal identities.** Arithmetic that must hold regardless of tags:
  eps × shares ≈ netIncome, balance coherence, FY-continuity, sign conventions,
  value-level bank reconstruction. Half-built: rich for US, near-zero for EU; the
  three identities just named exist nowhere.
- **L3 — rendered page.** The built HTML is honest: no mojibake, no blank sections
  where an honest unknown belongs, no stale derived figures (the AXS $1.3T wall
  class), rendered marquee numbers match committed JSON. One-tenth built:
  verifyStatic counts files and byte-sizes; nothing inspects content.

## Ranked build list

- **N1 — `scripts/sweepFiling.mjs` (L1, network, the big rig).** Rotating sample
  (~130 names/day → full universe monthly; EU+JP 100% monthly). Re-fetch by
  committed `cik` (US/ADR), `docId` (JP — `sourceUrl` is a search page), and
  `sourceUrl` (EU). Independent selector collects ALL candidate tags/contexts per
  concept for the committed FY, then asserts: committed value is a member of the
  candidate set (±0.5%); committed revenue is not a sliver of the max plausible
  candidate; NI matches the attributable candidate where attributable and total
  both exist; fy matches independent period-end normalization; currency and share
  scale agree. Own scheduled workflow, email-on-fail, never blocks data commits.
- **N2 — `scripts/auditIdentities.mjs` (L2, offline, all four pools incl. EU).**
  I1 eps×shares≈NI (JP/EU where shares are not themselves derived from NI/eps —
  skip the circular cases; ±20% JP for issued-vs-weighted basis, ±5% EU).
  I2 opInc component recompute where rev/COGS/SGA/R&D present (catches the
  deriveOpInc EBIT-proxy overstating for hedge-heavy filers). I3 balance
  coherence incl. totalDebt ≤ totalAssets (bounds the US max-across-aggregates
  hole). I4 quarterly TL+SE vs TA in [0.8, 1.15]. I5 sign conventions (EU capex is
  un-abs'd today). I6 value-level bank recon for ADR/EU. Blocking, with the N7
  ratchet absorbing the known tail.
- **N3 — `scripts/auditContinuity.mjs` (L2, offline) + the 2-line revival.**
  fy contiguity (gaps/duplicates/future years — the Jan-1-trap symptom); YoY
  swings >70% warn; share-count steps >2.5x error (ADR has no fixShareScale — a
  millions mistag ships today); ttm vintage on ALL lines (the existing ADR
  anti-freeze guards revenue only). And: set PRIOR_DIR in the four data workflows
  so auditIntegrity's cross-refresh delta check — which has never once run —
  finally runs.
- **N4 — extend `scripts/verifyStatic.mjs` (L3, inside every build).** Mojibake
  byte-scan of all dist HTML (hard fail); per-/c-page minimal content (ticker
  present, record rows, sections non-empty or explicitly unknown); absurd-figure
  scan (any rendered magnitude >$10T fails — the AXS class at the last line of
  defense); marquee cross-check of a few data-testid figures vs committed JSON.
- **N5 — stale-derived cross-checks (offline).** segments.json fy within 2y of
  fundamentals + axis-sum sanity; drivers.json pct re-verified against current
  history; language.json wall ties run unconditionally in every workflow (today
  skipped when the wire has no filers); adrRatios staleness.
- **N6 — EU parity pack.** Load EU into auditBelievability; add fundamentals.eu.json
  to checkFreshness; fix withheld-drops-prior (one below-floor parse currently
  deletes a previously good record — switch to JP-style carry + logged error).
- **N7 — identity baseline.** SHIPPED as continuity-baseline.json, redesigned in
  Wave 1's adversarial review from counts to IDENTITY SETS (the ticker list per
  pool/code): counts open silent headroom when fixes land and pass same-code
  swaps; sets fail any NEW name immediately, print fixed names as prunable, and
  make every failure actionable by ticker. A corrupt baseline file fails loudly
  as its own headline (the hand-edit flow invites typos). Gates are POOL-SCOPED
  per workflow (POOLS=JP etc.) so a break in one pool reddens only the workflow
  that writes it.
- **N8 — ADR robustness parity.** Port fixShareScale; atomic tmp+rename write;
  the missing revenue−costsAndExpenses branch in ADR deriveOpInc (the comment
  claims it, the code lacks it); currency-vs-country cross-check.
- **N9 — bellwether value anchors.** Promote ~15 anchors from existence checks to
  golden VALUES verified against the filing documents themselves (not
  companyfacts — independence), one per past bug class: AER (lessor), DEO
  (attributable), FNV (ttm-freeze), AXS (wall), plus megacaps. Cheapest L1-lite,
  every data workflow.
- **N10 — wire the never-wired.** audit:lang into fundamentals.yml; decide
  --strict posture per warn-tier check.

## Past bug class → catching check

| Bug class | Catcher |
|---|---|
| Lessor revenue sliver (AER $0.02B vs $8.5B) | N1 sliver-vs-max; N9 AER anchor |
| Megabank IFRS gross-vs-net | N1 bank-aware compare; N2 I6 |
| Attributable-vs-total NI (Diageo) | N2 I1; N1; N9 DEO anchor |
| Jan-1 fiscal-year trap | N1 independent fy; N3 contiguity |
| Stale derived wall (AXS $1.3T) | N4 absurd-figure at build; N5 unconditional ties |
| deriveOpInc overstating (hedge-heavy) | N2 I2 component recompute |
| ADR ttm-freeze (FNV) | N3 ttm vintage all lines; N9 FNV anchor |
| Share-scale mistag | N3 step detection; N8 ADR fixShareScale |
| EU revenue collapse | N3 generalized to NI/assets/equity |
| Hollow foreign-bank cohort | N2 I6 value-level |

## Dead guards found at kickoff (2026-07-15)

auditLanguage.mjs (entire file, wired to nothing); auditIntegrity's PRIOR_DIR
delta (never run); every audit's --strict tier (never blocks); auditData/auditJp
per-company ERRORs (print, exit 0); audit:believe never in fundamentals-jp.yml;
EU never loaded into believability; fundamentals.eu.json absent from
checkFreshness; fundamentals.yml debug input skips all audits; wire.yml audits
conditional on periodic filers landing.

## Execution

Wave 1 (offline, small, this week): N3, N4, N6, N7 + PRIOR_DIR revival →
run universe-wide → first error map. Wave 2: N2, N5, N9, N8. Wave 3: N1, the big
rig, plus the shelf-by-shelf verified sweeps the map orders — biggest names
deepest, financial shelves expected worst (the deferred EU banks live there).
Every wave: build → adversarial workflow review → fix → gate → ship.

## Wave 1 shipped (2026-07-15) — the first error map

Detectors live: auditContinuity (series gate, identity baseline, pool-scoped),
verifyStatic content tripwires (mojibake / absurd-money ≥10T with verbatim-prose
exemption by class / body-ticker identity), the same mojibake tells scanned in
committed DATA by auditIntegrity (pre-commit, so a data artifact reddens the
responsible workflow instead of freezing deploys), EU loaded into believability
and the freshness heartbeat, the EU withheld-drops-prior fix, PRIOR_DIR set in
all four workflows (the cross-refresh delta ran for the first time ever).

The map (error tier, all verified classes): 176 share-scale mistags (121 ADR —
no fixShareScale there; N8 fixes the cohort), 27 frozen TTMs shown as current
(BLK, DTE among them; BPOP's is from 2012 — N8's purge + guard), 5 fy desyncs,
1 undated record (CNI). Zero Jan-1-trap hits — the EU fyOf normalization holds
universe-wide. Warn tier (the suspect list, verify-before-counting): 1,039
revenue swings, 886 share steps — including AAPL's own series mixing
split-adjusted and as-filed share bases at FY2017→FY2018, the basis-seam class
that makes per-share arithmetic wrong across the seam; a Wave 2/3 decision.

Adversarial review of the wave: 22 confirmed findings, all fixed pre-commit
except two accepted-and-documented: (a) one bad filer still blocks the whole
daily wire commit (conservative by design for now; revisit if it fires), and
(b) the $1–10T absurd-money band is unpoliceable page-wide ($3–4T market caps
are real) — that band belongs to B7 at the data level, where the wall ties to
balance-sheet debt.
