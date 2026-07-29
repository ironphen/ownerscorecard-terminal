# Utilities Desk — Survey and Rulings (Desk #7)

*Surveyed 2026-07-28 (six agents: tag census, centerpiece, cohort audit, live defects,
cross-desk scorecard pattern, hostile replication — run wf_26b2f044-6a4; the skeptic
replicated every load-bearing number and corrected three). Rulings made under the
delegated-ratification grant of 2026-07-28: decided by how Graham, Buffett and Berkshire
would address the sector, recorded here, reversible by the owner.*

## The cohort

118 rows sit on the four utilities shelves; 98 are primary businesses (67 US, 23 ADR, 5 JP,
3 EU). Of the US primaries, 13 carry none of the regulated economics (Vistra, NRG, Talen,
Constellation, YieldCos, RNG sellers); of the ADRs, 12. **Membership rides the ≥5-concept
rate-regulated tag-family gate**, which separates the pool at 3-versus-7 with zero overlap.
Element *presence* was refuted as a membership test: it admits Genie Energy (a reseller
tagging one regulatory liability) and Hallador (a coal miner tagging one regulatory asset).
The desk's reachable cohort is **~54 businesses** (51 US + 3 US-GAAP Canadians). The 8 IFRS
regulated ADRs, the JP pool and the EU pool are out of reach of this tag set, and the pages
must not imply otherwise.

## What XBRL carries (census over 67 US CIKs)

| concept family | undimensioned latest FY | verdict |
|---|---|---|
| Regulatory assets & liabilities | 55/67 (NetRegulatoryAssets is Southern's only carrier) | strongest family on the shelf — ship |
| Net utility plant (PublicUtilities\* tags) | 40/67 (+PlantInService carrier for the UGI class) | ship as plant growth; **never labeled rate base** |
| AFUDC equity leg | 29/67 (borrowed leg decayed 27→12) | ship descriptive share; withhold dark years |
| Fuel / purchased power | 16/67 and shrinking (giants moved under ProductOrServiceAxis) | too thin — refuse the column |
| Rate base | 0/67 (one filer, three stale facts, ever) | **the number does not exist in XBRL** |
| Allowed ROE | 7/67 ever, 1 current; rich per-rate-case behind axes at DUK (16 facts), SO (15), AEP | keyhole watch-item lane only |
| Storm/wildfire/securitization | no standard family; zero /Wildfire/ elements | withhold |

Capitalized interest (`InterestCostsCapitalized`) is **distinct from AFUDC-borrowed** —
six of six same-year pairs differ. Never a fallback chain between them.

## The rulings

**REFUSED**, each with its measurement, on Graham's ground that a figure which must be
interpreted before it can be believed is a hazard, not a fact:

- **An allowed-ROE column.** 7/67 ever tagged undimensioned; the same concept verifiably
  carries Alabama Power *equity ratios* (0.537) and a SPAC's 0.15 beside genuine 9–10%
  returns, distinguishable only by context a reader never sees. Goes to the keyhole
  watch-item lane with named targets (DUK, SO, AEP) and the full verification ceremony.
- **Anything labeled "rate base."** Not in the data. Net utility plant is the honest proxy
  and is labeled as what it is.
- **An earned-versus-allowed spread.** One leg consolidated GAAP, the other
  per-jurisdiction regulatory: mismatched denominators dressed as one number.
- **A fuel-adjusted operating margin.** 15/67 coverage; annotate the pass-through, never
  adjust the figure — an adjusted margin would be the seventh blanket-rule disaster.
- **An AFUDC "earnings-quality" penalty.** A high-AFUDC year marks heavy reinvestment at
  the allowed return — the thing Buffett's BHE letters prize. Descriptive share only.

**THE CENTERPIECE** (Buffett's framing: a regulated return on a growing invested base):
earned ROE through the record (consolidated-labeled — no undimensioned regulated split
exists; holdco rows carry a standing disclosure sentence), net utility plant growth as the
reinvestment runway, AFUDC-equity share as context, regulatory assets/liabilities as filed.

**THE HOLDCO TRAP** is disclosed, never repaired: NEE, SRE, UGI, AES, OTTR pass the
membership gate and their consolidated figures overstate the regulated book. The honest
sentence on those rows: "consolidated figures; the regulated share is not separable in the
filing." A per-subsidiary read exists later through the ~11 standalone opco registrants
(all four Xcel opcos file undimensioned) — a named-target expansion requiring pool-keying
for ticker-less registrants.

## The build plan

**WAVE A — live wrong numbers (SHIPPED d5172b3):** OGS's FY2025 page printed FY2022's
revenue verbatim → corroborated fill (overlap-equality gate, five years exact) + staleness
guard keyed to the anchor's fiscal year, never max(end) (the PPL forward-dated-lease-fact
trap, proven by the skeptic); Duke's $3.30B of dividends invisible → PaymentsOfOrdinary-
Dividends appended as a per-year ladder rung (32 filers gain, none loses); AES's bridge
printed a −$1.46B "non-cash add-back" → the D&A row withholds non-positive values and the
residual absorbs the reconciliation.

**WAVE A, REMAINING:** the listings tie-break (DTE's shelf row is its 2080 baby bond DTB —
equal-length tickers tie-break alphabetically; needs a filed fact, not a suffix heuristic;
same for the retired PNM/TXNM pair); capex keyhole registrations for the 13 null filers
(NEE has *no* undimensioned capex tag — verified); the three double-counted issuer groups
CIK-dedup cannot see (BEP+BEPC, NEE+XIFR, NGG=NG across pools).

**WAVE B — pipeline text, one function, 68 pages:** the regulated-utility quality paragraph
replacing "price-taker territory" (a regulated monopoly described as its exact inversion);
Graham's own 1972 substitution for utilities (exempt from the current-ratio test he
exempted them from — 75/83 currently fail it — judged instead on debt ≤ 2× equity plus the
dividend record); EXC spin-aware revenueGrowing; owner-earnings rate-base sentence.

**WAVE C — columns**, membership = the ≥5-concept gate, n≈54, each decided for the peer
bench per the completeness guard, each reading through the record via the shared
readThroughRecord wrapper (see below): regulatory assets & liabilities; net-utility-plant
growth; AFUDC-equity share; earned ROE through the record. Bench ruling: drop gross margin
for the utilities cohort (69/83 blank, 3 verified fragments lead the bench today).

## The cross-desk prescription (applies before Wave C)

32 of 37 live scorecard checks across the seven shipped desk surfaces read latest-FY only
beside a ten-year record; the flow-class defect (check blank while the record holds ≥2
prior years) lands on ~150 company rows — worst on banks' net charge-offs, 48 of 241
(21%, the Bank7 shape). One shared `readThroughRecord()` wrapper lands beside
`recordMedian`/`shortRecord` in fundamentals.mjs, once; stock checks (capital ratio, HTM
marks) stay latest-FY *correctly* — the fix applies only to flow/cycle reads. Utilities
builds on it from day one, because per-jurisdiction dimensioning makes the latest year the
*most* likely year to be missing.

## Owner-earnings on a growing utility (open, the hardest honest question)

`maint = depreciation` excuses every dollar of rate-base capex above depreciation on 74
"growing" names (SRE prints +$2.0B owner earnings against −$6.05B free cash flow), while a
10% revenue knife-edge marks EXC and MGEE "consumes cash" — both directions wrong at once.
The Buffett-honest read for a regulated utility is that growth capex earns the allowed
return and is *financed*, not expensed against the owner — but presenting that requires the
plant-growth column (Wave C) beside the bridge, plus the standing sentence, not a new
formula. No adjusted owner-earnings figure ships; the bridge already shows both ends
(owner earnings and free cash flow) and the desk adds the context line between them.
