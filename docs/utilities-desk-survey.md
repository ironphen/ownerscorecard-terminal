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
rate-regulated tag-family gate.** *(Corrected by the Wave C census, wf_be39d3c2, hostile-
replicated: the survey's "3-versus-7 with zero overlap" was wrong at count 4 — NRG and ONEOK
land there — but the separation is real: failers top out at 4, passers begin at 7 (UGI), so
the ≥5 cut sits inside a clean two-wide empty band and any threshold in 5..7 admits the
identical cohort.)* Element *presence* was refuted as a membership test: it admits Genie
Energy (count 1) and Hallador (count 1). The gate is CANDIDATE-SCOPED (SIC 4900-4991 or a
taxonomy Utilities override), never universe-wide: EQT would pass at 9 on the legacy tags of
its pre-spin pipeline business. The exhaustive control sweep found one genuine seam: **MDU
Resources** (count 13, SEC SIC stale at mining from the Knife River era) is a pure regulated
utility post its two spinoffs — it received the taxonomy override and gates in. The measured
cohort is **76 rows, 60 distinct CIKs** (US pool: 70 rows, 55 CIKs, flagged `rateRegulated`
at extraction). The IFRS regulated ADRs, the JP pool and the EU pool are out of reach of
this tag set; the three US-GAAP Canadians (AQN, EMA, FTS) file the concepts on 40-F in CAD,
which the 10-K/USD readers correctly skip — their read is a deliberate follow-up, not a
silent extension. TC Energy (TRP) is a US-GAAP 40-F filer that would likely gate in once its
payload is fetched.

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

**WAVE C — columns (SHIPPED 2026-07-28).** The pipeline gained `scripts/utilitiesLines.mjs`
(the gate + four extractions, banks-desk architecture) and every surface consumed it:

- *The gate*: `rateRegulated` decided at extraction, persisted on the record; scorecard,
  lens and columns all route on it, never on SIC. Vistra/NRG excluded at the count itself.
- *Regulatory assets & liabilities*: the current+noncurrent pair, both legs present in the
  year, or noncurrent alone for a filer that never tags a current portion. Total tags are
  NOT read in this wave — Southern's undimensioned RegulatoryAssets is a component ~100×
  below its NetRegulatoryAssets series (a wrong number, not a missing one), and ATO/NFG
  totals run 1.3-105× the pair. A corroborated total-tag fill (the OGS/Brixmor gate) is a
  measured follow-up. NetRegulatoryAssets ships as-filed as the net position (SO's only
  long series).
- *Utility plant*: basis-locked per filer (net ≥4y or ≥gross-years wins; else gross
  plant-in-service; `utilityPlantBasis` travels on the record; net-vs-gross differ 23-49%
  and are never mixed). Growth = annualized over the readable record, recordMedian's
  {value, years, of} shape so gaps and short records carry their count. The 12 regulated
  filers whose plant is subsidiary-dimensioned withhold with a named label.
- *AFUDC equity*: the single tag, zero switches, zero overlap disagreements; dark years
  withheld; share of net income only when income is positive; latestReported fallback on
  the scorecard. WTRG's instant-shaped variant is a deliberate exception NOT taken.
- *Earned ROE*: cyc(returnOnEquity) reused verbatim — no new arithmetic.
- *Company page*: `buildUtilityScorecard` (src/lib/utilities.mjs) replaces the industrial
  scorecard for gate-passers — earned ROE vs the allowed band, AFUDC share, plant + growth,
  the regulatory ledger, and the holdco disclosure on NEE/SRE/UGI/AES/OTTR.
- *Bench (measured over the 54 utility benches)*: earned ROE clears half on 54/54, plant
  growth 46/54, dividend coverage 54/54 — the utility lens is [roe, plantGrowth, payout].
  AFUDC share cleared 33/54 and is REFUSED_ON_BENCH; gross margin never enters (69/83
  blank on the old heavy benches). The peers lens guard now splits on the gate flag, so
  Southern's bench can no longer seat Vistra.
- */groupings*: the four shelves moved family heavy→utility; the industry tables carry
  [revenue, roe, plantGrowth, afudcShare, regAssets, regLiabilities, dividendsPaid]; the
  SECTOR table narrows by hand amendment (rule step 4) to [revenue, netDebt, roe,
  dividendsPaid] because the specialist columns answer 34-53% at sector scale where the
  merchant rows honestly dash.

**WAVE C FOLLOW-UPS, measured and queued**: the ADR utilities read (40-F + CAD instants for
AQN/EMA/FTS; fetch TRP's payload); the corroborated total-tag fill for the regulatory pair;
WTRG's instant-shaped AFUDC exception (needs one 10-K text verification); the NFG equity
cross-tag guard in fetchFundamentals (undimensioned StockholdersEquity −625.7M against
Inc-NCI 2,079.9M for FY2022-24 — the parent+NCI=total identity is the discriminator; DUK
FY2015 carries a bogus −1M parent-equity fact of the same class); the extension-tagged
dividend keyholes (FRT, SPG, BDN, PSA's preferred-inclusive capital distribution).

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
