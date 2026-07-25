# OWNERSCORECARD SOFTWARE DESK — TAG CENSUS, REPAIR ORDER, AND DRAFT SPEC

*Fourth analyst-desk filing under the desks strategy. Nine Berkshire-schooled agents: one cohort-hygiene audit, one live-defect hunt over the shipped record, five tag-census tiers covering fifteen filers, one Munger-inversion traps lens, and one RPO deep-dive against raw inline-XBRL instances (filed separately, 2026-07-22, and already complete). Desk protocol: survey -> THIS SPEC -> owner review -> extraction code -> hostile verify -> ship.*

*This survey is unusual in one respect and the owner should read it in that light. The insurance, banks and managed-care desks each found gaps — concepts the pipeline had never reached. The software desk found those too, but its largest finding is a REPAIR ORDER, and the repairs are not confined to software. Three of the defects below are core-extractor defects that put wrong numbers on company pages across the whole terminal. Section 1 is therefore ordered before the census, and Q1-Q4 are the questions that matter most.*

Evidence base and tier shorthand:
- MEGA: MSFT, ORCL, ADBE
- SAAS-LARGE: CRM, NOW, INTU
- GROWTH: SNOW, DDOG, HUBS
- VERTICAL: TYL, SSNC, PTC
- SMALL: APPF, PCOR, HSTM (HSTM substituted for BL, which no longer files; substitution documented by the agent)
- COHORT: full 250-row Software shelf audit against taxonomy.json and shelves.json
- DEFECT: full 186-member shipped-record hunt against fundamentals.json asOf 2026-07-22, with live companyfacts re-derivation
- TRAPS: MSFT FY2025 and CRM FY2026 10-Ks read in full, plus ORCL FY2026

Confidence scale: HIGH (verified filer-by-filer against filed data this session) / MEDIUM (established by internal year-matching, successor tag not yet named) / LOW (single-filer observation) / WITHHOLD (not extractable honestly).

School frame (binding): a software business sells a promise to keep serving. Its float analog is the contracted backlog not yet earned, and the honest question is not how large that backlog is but how much of it lands inside a year. Its owner-earnings problem is that the largest cost of many of these businesses — the equity handed to employees — is charged to the income statement and then apparently undone by a buyback that mostly stands still. Gross margin here is nearly meaningless without knowing what sits above the line; the customer-acquisition outlay is the number that decides whether growth was bought or earned.

---

## 1. THE REPAIR ORDER — wrong numbers on the shipped record

All six were verified against live companyfacts this session. Ordered by owner harm. F1-F3 are POOL-WIDE core defects, not software-specific.

### F1. The SG&A row omits sales and marketing (SHELF-WIDE, and beyond)
`scripts/fetchFundamentals.mjs:173` reads `sgaExpense: ["SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense"]`. Software filers overwhelmingly do not file the combined element; they file `SellingAndMarketingExpense` and `GeneralAndAdministrativeExpense` separately. The chain takes the second, and the row is labelled "SG&A / revenue."

Verified filer by filer: CRM prints 7% against a true 42%. ORCL 2% against 15%. NOW 8% against 42%. ADBE 7% against 34%. INTU 9% against 35%. MSFT 3% against 12%. GEN prints 5.8% on the same mechanism. A residual detector (revenue less cost of revenue, SG&A, R&D and operating income) flags an unexplained opex bucket above 10% of revenue for 130 of the 160 shelf members carrying all five lines.

This is the industry's Munger inversion sitting inside our own extractor: software accounting parks customer-acquisition cost where the standard combined tag cannot see it, and we then publish the remainder under the combined tag's name. A reader comparing Salesforce at 7% overhead against a retailer at 20% draws precisely the backwards conclusion. Confidence HIGH.

Recommended fix: where `SellingGeneralAndAdministrativeExpense` is absent and both `SellingAndMarketingExpense` and `GeneralAndAdministrativeExpense` are present, ship their sum. Where only one leg is present, ship nothing and let the row read withheld — a half-bucket under a whole-bucket label is the same error in smaller print. Gate: the reconstructed SG&A must not exceed revenue less cost of revenue.

### F2. The stale-current tripwire does not survive the record merge (POOL-WIDE)
The tripwire shipped with the banks desk (`pick()`/`inst()` null a chain whose latest fiscal year precedes the anchor year, `fetchFundamentals.mjs:1112-1122`) is correct and was verified to fire correctly when re-implemented against live data. It never runs for a company that is not re-fetched, because the whole-record carry-forward at `:1719-1721` preserves the pre-tripwire record wholesale. The tripwire heals a company only on the day that company is re-fetched.

The live consequences, each an impossible or misleading number now on a page: ORCL ships a FY2011 cost of revenue against FY2026 revenue and prints a 96.9% gross margin. INTU ships FY2017 and prints 99.4%. CDNS ships FY2012 and prints 98.6%. CACI ships FY2019 and prints 46.6% — plausible, and therefore the dangerous one, because no value-implausibility check would ever catch it. TTWO prints R&D at 1% of revenue on a FY2011 figure against a true 16%. ACIW prints 5% on a FY2011 figure against a true 9.5%. META's net plant reads $24.7B, its 2018 balance, against a true $176.4B. Alphabet's reads a year stale. CRM carries FY2019 payables and FY2019 interest expense on a FY2026 record. TBLA and YOU carry share counts two and three years old, which corrupts eight per-share rows apiece. Roughly thirty further members carry a stale prior-year `interestExpense` or `totalDebt`.

This is the same family as the two carry-over resurrection bugs already killed this month, and it is the general case of both. Confidence HIGH.

CORRECTED ON VERIFICATION (2026-07-22, and this correction matters because the first answer would have done harm). The survey originally recommended applying the anchor-year test to the merged output. That is wrong, and testing it proved so: the anchor-year history row legitimately lacks lines the current record legitimately carries, and a blanket vouching rule flagged 2,346 of 2,825 companies — it would have blanked thousands of good values to fix a few dozen bad ones.

The tripwire itself is correct. Re-fetching Oracle alone nulls its 2011 cost of revenue exactly as designed. The stale records are simply older than the rule, and the whole-record carry preserved them. So the repair is operational rather than structural: one full-pool re-fetch heals every one of them, and the weekly CI already re-fetches the whole pool, so they stay healed.

What DOES need building is the thing that let this hide for so long: nothing on a record said when it was last extracted, so a decade-old figure was indistinguishable from this morning's. Each record now carries a `fetchedAt` stamp, every run reports how much of what it published is old and how old the oldest is, and `FUND_STALEST=n` sweeps the pool by age. See §9.

### F3. Fiscal-year labels are wrong for 52/53-week filers ending January 1-14 (POOL-WIDE)
`fetchFundamentals.mjs:427` and `:453` assign `fy` from the calendar year of the period end. For a 52/53-week filer whose year ends in the first fortnight of January, that is a year too high, and worse, it collides two real years into one bucket and silently erases one.

LDOS: the period ended 2026-01-02 is Leidos fiscal 2025 by its own accession focus; we label it 2026, the mislabel runs backwards through the record, and FY2020 has been erased entirely by a collision with FY2021. CDNS: the period ended 2021-01-02 is Cadence fiscal 2020, labelled 2021, and FY2021 (revenue $2,988M) is gone from the record.

Every other odd-calendar filer checked is labelled correctly — MSFT June, INTU July, ORCL May, ADBE November, and the twenty-odd late-January enders including CRM. The failure is confined to period ends falling January 1-14. Confidence HIGH.

Recommended fix: assign `fy = calendar year - 1` when the period ends January 1-14. Verified safe against every late-January filer on the shelf. Note for the record: EDGAR's own `fy` field is NOT a usable substitute (see §2.1).

### F4. Two successor tags leave lines dark or stale
`researchDevelopment` is null for 9.1% of the shelf. `ResearchAndDevelopmentExpenseSoftwareExcludingAcquiredInProcessCost` (exact spelling confirmed present) recovers ADBE ($4,294M), EA ($2,828M), CDNS ($1,769M), TYL ($205M) and PRGS ($192M), and is also the live tag behind the stale TTWO and ACIW figures in F2. ADBE files no `ResearchAndDevelopmentExpense` element at all. SABR, TRIP, DSP, MQ, PRCH, RDVT, IIIV, PSN and GDDY carry no us-gaap R&D element of any kind and are honestly dark.

`costOfRevenue` is null for 6.5%. `CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization` (singular "Service") recovers GDDY ($1,801.5M), XPER ($126.6M) and EVCM ($132.1M). Caveat that must ship with it: the element excludes depreciation and amortization, so a gross margin built on it alone flatters. Label the basis or withhold. Confidence HIGH on the tag names, which were read from companyfacts this session.

Explicitly do NOT add `CostOfGoodsAndServicesSoldAmortization` to the cost-of-revenue chain — it is amortization of acquired technology only, and the agent flagged it as the near-miss that would have produced a new wrong number.

### F5. `netPPE` is a single-tag chain with no successor
`fetchFundamentals.mjs:263` reads `PropertyPlantAndEquipmentNet` alone. META's series dies at 2018 and Alphabet's at FY2024, which is why META's asset intensity reads $24.7B against a true $176.4B. Both are recovered by adding the successor element the filers moved to. Confidence HIGH on the defect; the successor tag name should be re-verified at implementation time rather than taken from this document.

### F6. Universe hygiene: ten rows that are not companies
GOOG/GOOGL/GOOGM/GOOGN are four rows for one issuer, each carrying the same $402,836M. IAC/PPLI, AUR/AUROW, RUM/RUMBW, SOUN/SOUNW, DJT/DJTWW and GEN/GENVR pair a company with its own warrant or contingent-value right, and CCC/CCCS duplicate. There are roughly 176 distinct businesses on a shelf we count as 186, and a warrant currently has a company page. Separately, ANSS sits on the shelf 18.7 months after its last 10-K because it was acquired and no longer files.

Recommended: collapse tickers sharing a CIK to one canonical record with alternate-ticker routing (the ADR/CIK routing already shipped for JP names is the pattern), and mark any member whose latest 10-K is more than about 15 months old.

---

## 2. WHAT THE STRUCTURED-DATA API WILL AND WILL NOT GIVE US

### 2.1 Three structural facts, each verified rather than assumed
1. **companyfacts carries no filer-extension namespace at all.** Tested at all fifteen filers. MSFT exposes only dei/us-gaap/srt/invest/ffd; CRM dei/us-gaap/ecd/ffd; DDOG dei/us-gaap/ecd. There is no `msft:`, `crm:`, `orcl:` or `now:` namespace in this endpoint. Every extension tag in the industry — including Salesforce's RPO band — is reachable ONLY through the Tier-2 keyhole parser.
2. **companyfacts carries only undimensioned facts.** Tested directly by taking tags that are always dimensioned in source filings and confirming their absence. This confirms the desk's prior and closes the question.
3. **The SEC `fy` field must be banned from the extractor.** It is filing-scoped, not fact-scoped: every comparative column in a 10-K inherits the filing's `fy`, collapsing three distinct years onto one key. It is also simply wrong — CRM's fiscal 2026 10-K carries fy=2025 while a 10-Q filed three months earlier carries fy=2026. PTC's quarters are mislabelled by a full quarter. Same for `frame`: SNOW's `NetIncomeLoss` is populated for eight years but only the three oldest carry a frame, so frame-filtering silently drops the five most recent years. Derive the fiscal year from the period end against the filer's confirmed FYE month, which is what the pipeline already does apart from F3.

### 2.2 The 606 seam contests nearly everywhere
There was not one clean contract-liability stitch anywhere in the SAAS-LARGE tier. CRM -1.41% at FY2018; NOW -5.45% current and -9.44% noncurrent at FY2017; INTU -39.5% current and -98.5% noncurrent at FY2018; MSFT -40% at FY2017; TYL -3.51% on the current leg while the noncurrent leg agrees exactly. Adoption years differ by filer (NOW 2017, CRM/INTU/MSFT fiscal 2018, ORCL 2019). SSNC never migrated at all and still files `DeferredRevenueCurrent` in its FY2025 10-K. APPF and HSTM stitch to the dollar.

The existing `stitchGenerations` machinery is the right tool and its contested-year withhold is the right answer. No generic adoption-year rule is available; the seam must be found per filer by testing overlap equality.

Two traps inside the seam: precision changes shadow it and will fire equality checks on their own (CRM moved from $1,000 to $1,000,000 rounding at exactly the 606 boundary; SSNC switched to nearest-$100k at FY2017; INTU's cover-page share count changed precision between FY2023 and FY2024). And an overlap that passes can pass for the wrong reason — PTC's revenue seam agrees exactly in both overlap years because Oracle-style double-tagging restated the same figure into both elements, which proves the tags were reconciled, not that the concepts match.

### 2.3 Live as-filed errors that nobody will ever correct
CRM's RPO at 2018-04-30 is tagged $20,400,000 against neighbours near $21,000,000,000 — a thousandfold error, eight years old, still in the file. HSTM's FY2009 diluted share count is 21,838 against a true count three orders larger. ORCL's `PreferredStockSharesIssued` frame for CY2025Q4 is the depositary-share count, 2,000x the true 50,000 preferred shares, and is internally contradicted by its own authorized figure. MSFT's `ContractWithCustomerLiability` frame for CY2018Q4I carries the June balance, not the December one.

Recommended gate, which the desk can build generically: reject any point more than 10x from the median of its four nearest neighbours in the same series, and log rather than repair.

### 2.4 The stock-split seam (the one nobody was looking for)
ServiceNow split 5-for-1 in December 2025. In companyfacts, taking latest-filed-wins per date, the diluted share count breaks between FY2022 and FY2023 while shares outstanding break between FY2023 and FY2024 — two different seam boundaries for the same event on the same filer, because restatement reaches back only as far as each statement's own comparative depth. Dollars are untouched; only share counts move, so no revenue or SBC tripwire would see it.

This corrupts every per-share series it touches, silently, by a factor of five. It is a strong candidate for the most urgent extractor defect in this filing after F1-F3. The detector is clean: `us-gaap:StockholdersEquityNoteStockSplitConversionRatio1` is filed and carries the ratio and date. The separator that keeps a genuine restatement from being mistaken for a split is an integer-ratio test — CRM's FY2023 shares-outstanding revision of 0.9722x is a real correction and must not be rebased.

### 2.5 Other extractor breakers found, each with the gate
- `AllocatedShareBasedCompensationExpenseNetOfTax` is an AFTER-TAX element. At INTU it is the longest SBC-named series available and understates the true FY2025 figure by 27.8%. Any preference list must exclude `/NetOfTax/` explicitly.
- `dei:EntityCommonStockSharesOutstanding` is a COVER-PAGE count at a post-year-end date at every filer checked. It is the freshest count and the right one for a current per-share figure, but it must never enter a balance-sheet identity and must never be labelled with the fiscal-year-end date. Keep it a separate series with its own measurement date. PTC omits it entirely from its FY2025 10-K; PLTR's is absent from companyfacts altogether (see §4.4).
- Sign convention is filer-specific on the same element: `AllocatedShareBasedCompensationExpense` is positive at CRM and NOW but negative at INTU; `ContractWithCustomerLiabilityRevenueRecognized` is stably positive at INTU, flips negative at NOW for two years, then flips back in a later filing.
- Trailing-digit tag generations are real, not typos, and both must be probed: `CapitalizedComputerSoftwareAmortization1`, `...IncurredClaims1`-style suffixes recur across the taxonomy.
- The same filer files two D&A tags differing by 3x. Selection must be a per-filer resolved tag with recorded provenance, never a first-match on a name pattern.
- SSNC is dual-CIK and nothing in its own submissions file says so: CIK 0001402436 holds the ticker, while CIK 0001011661 filed 10-Ks for FY1996-FY2010, overlapping at FY2009-FY2010. Ticker-only assembly silently drops fifteen years.
- TYL's `RevenueRemainingPerformanceObligation` DIED after 2024-10-23 — zero facts filed since, while the FY2024 and FY2025 10-Ks sit in the same file. A series that stops while the filer keeps filing needs a death detector, or it ships a three-year-old backlog as current.
- PTC's FY2026 10-Qs introduce discontinued-operations tags and RPO fell 14.4% in a quarter. Forward tripwire, not history.
- IIIV ships a cost of revenue of exactly zero against $213M of revenue, printing a 100% gross margin. A captured zero against non-zero revenue should be treated as missing, not as zero.

---

## 3. THE DESK CENTREPIECE: REMAINING PERFORMANCE OBLIGATIONS

### 3.1 Why the total alone must never ship
Oracle's FY2026 10-K reports RPO of $638 BILLION against revenue of $67,357M — 9.5x revenue, up 4.6x in a single year. In the same disclosure Oracle's own near-term band collapsed: the share expected within roughly twelve months went from 62% (FY2019-20, when it was still tagged) to 12% (FY2026, prose only). The headline number rose elevenfold while the part of it that is nearly-certain revenue shrank by four fifths.

That is the whole case for the gate. Total RPO is a DURATION figure; the twelve-month band is the DURABILITY figure; across filers they diverge by a factor of four. Publishing the total alone would hand a reader the single most misleading number in the industry, dressed as backlog strength.

RECOMMENDED HARD GATE, no exception: total RPO is suppressed unless the twelve-month band resolves for the same period end. If the parser misses, the whole disclosure is withheld with its reason.

### 3.2 Where the band actually lives (deep-dive, complete)
Confirmed across fifteen filers: the band survives undimensioned for NONE of them. What exists in companyfacts is fossils — NOW has exactly one percentage fact ever (a 10-Q in 2018), TYL two facts both in 2018, PCOR two years then abandonment, MSFT FY2018 only, ORCL FY2019-20 only. Every current band is either dimension-locked or prose-only.

Three patterns, all mapped against raw instances:
- **Pattern A, typed percentage (MSFT, NOW):** `us-gaap:RevenueRemainingPerformanceObligationPercentage`, a filed fraction (ix `scale="-2"`), in a context with zero explicit members and exactly one typed member on `...ExpectedTimingOfSatisfactionStartDateAxis`, whose inner element is the axis QName + `.domain` and whose content is a bare date equal to the balance-sheet instant plus one day.
- **Pattern B, extension dollars (CRM):** `crm:RevenueRemainingPerformanceObligationCurrent` and `...Noncurrent`, dollars, default context. WFC-precedent extension exception, gated on Current + Noncurrent equalling the us-gaap total, which held to the exact dollar at three consecutive year ends.
- **Pattern C, prose only (ORCL FY2026, ADBE enterprise carve-out):** the band is stated in words and tagged nowhere. Not extractor territory. Withhold, or route to the Notes pipeline.

Three gates, all load-bearing, because NOW files 13-36-month decoy contexts on the same axis and CRM's decoy shares the same date: explicit-member set empty; typed date equals instant plus one day; and the SAME context carries `...ExpectedTimingOfSatisfactionPeriod1 == 12` months. Any gate failing withholds the band. The Period1 fact is `ix:nonNumeric` (`format="ixt-sec:durmonth"`), so `parseFacts` needs a narrow non-numeric branch.

Parser work required: `parseContexts` captures typed-member triples rather than only flagging `typed:true`; `contextMatches` gains an opt-in typed spec while keeping blanket typed refusal as the default; `parseFacts` gains the duration-month branch. Full spec drafted separately and verified against the parser as it stands at a4c73da.

### 3.3 Two doctrine rulings this raises
- **Never derive twelve-month dollars.** Percentage times total manufactures a number Microsoft itself calls "approximately." Publish the fraction as filed.
- **RPO precision differs by filer and must be shown.** DDOG tags to $0.1M, SNOW rounds to $0.1B from 2021 onward, HUBS collapses to one or two significant figures after 2024-09-30. A cross-filer table without a precision column presents $9.8B, $3.4612B and $1.6B as though they were measured alike.

---

## 4. THE DILUTION LEDGER — the desk's best original reading

The traps lens worked the arithmetic from filed data at three filers, and the answers differ so completely that this must be computed per filer and never asserted as an industry trait.

**MSFT FY2023-25.** SBC expense $32,319M. Repurchase cash $57,919M. Shares outstanding went 7,464M to 7,434M — down 0.40%. At roughly $420 a share the 30M net shares actually retired are worth about $12,600M, so 21.8% of the outlay bought ownership and 78.2% was mop-up. Net of the $5,924M received back from employees, the cash cost of neutralising employee issuance ran about 1.22x the expense booked for it. In FY2025 alone, $18,420M left the company and the share count did not move at all.

**CRM FY2026.** The share roll ties exactly — 962M outstanding, plus 17M issued to employees, less 50M repurchased, equals 929M — so this is arithmetic, not estimate. The buyback more than offsets issuance, but roughly forty cents of every dollar merely stands still.

**ORCL.** The opposite state, and the more honest-looking one. Repurchases collapsed from $16,248M in FY2022 to $95M in FY2026 while SBC rose to $4,811M, and the diluted count ROSE 8.1%. There is no mop-up because there is no buyback. The absence of the buyback IS the finding, and a ledger that only reports repurchase dollars would show a small number and say nothing.

**SNOW, HUBS, DDOG, PCOR, PTC.** All fail the offset test outright; several have never repurchased at all while counts climb.

Two hazards found in the process, both of which would generate wrong numbers:
- `PaymentsForRepurchaseOfCommonStock` is not like-for-like across filers. MSFT's $18,420M INCLUDES $5,400M of shares taken back to settle employee tax withholding (the reconciliation ties to the dollar against the program figure); CRM's $12,596M excludes it, with the withholding on a separate financing line. Whether the withholding sits inside the tag is stated only in prose. Where both tags exist, test whether program dollars plus withholding equals the repurchase tag, and record which convention the filer uses.
- The diluted weighted-average count and the period-end count disagree materially and in opposite directions (CRM FY2026: -1.85% weighted-average against -3.4% period-end). Both should be shown; neither alone is the answer.

Proposed line set for the ledger, all filed, no estimates: SBC expense; SBC as a share of operating cash flow; net change in diluted weighted-average shares AND in period-end shares outstanding; repurchase cash with its convention flagged; and, where the share roll ties, the fraction of the outlay that actually bought ownership.

---

## 5. MUNGER INVERSION — the remaining traps, verdicts as found

- **Capitalised commissions (ASC 340-40): CONFIRMED at some filers, REFUTED as universal.** CRM deferred $614M of commission spend off the income statement in FY2026 after two flat years, and carries a $5,060M contract-cost asset, 12.2% of revenue, amortising over about 2.3 years, with EXACTLY ZERO impairment reported in all seven years the tag exists — a period including a demand air pocket. The zero is an assertion about churn, and it deserves to be visible. Microsoft does not capitalise commissions at all, by disclosed policy: a missing tag here is an accounting fact, not a data gap, and must never be rendered as one. Tag families are mutually incompatible across three filers in the same tier (SNOW, DDOG and HUBS each use a different one; HUBS uses the generic `DeferredCosts` family). PTC files amortisation with no asset balance — a numerator with no denominator, which must withhold.
- **Capitalised software development: LARGELY REFUTED at large-cap scale, and it surfaced something worse.** ORCL capitalises nothing that reaches companyfacts; MSFT tags only two amortisation elements, both dead after FY2018. But a line labelled "Capitalized research and development" appears in the DEFERRED TAX ASSET table of several filers — it is the Section 174 tax-capitalisation item, has nothing to do with capitalising development cost for book purposes, and any label-driven or text-driven extraction would confuse the two and invent a capitalisation policy that does not exist. This needs an explicit denylist. Two gates: refuse to publish any capitalised-software figure unless a `CapitalizedComputerSoftware*` fact carries a period end inside the filing's own fiscal year; and denylist the deferred-tax label.
- The capitalisation SPECTRUM is a real cross-filer reading and the direction of travel matters more than the level: PTC capitalises nothing, so its R&D is complete development spend; SSNC capitalises aggressively and rising and reported its first-ever R&D decline in the same year; PCOR's ratio rose from 11.8% to over 15%; HSTM adds 55.9% on top of expensed R&D. R&D is not comparable across this shelf without that column.
- **Acquired deferred revenue and acquired RPO: CONFIRMED, and degrading.** CRM's FY2026 RPO includes about $2.2B from Informatica, disclosed in a footnote. The tag that would have made this machine-readable, `ContractWithCustomerLiabilityIncreaseDecreaseForContractAcquiredInBusinessCombination`, has been filed by CRM five times historically but is ABSENT for FY2026 — the year it mattered. Recommended: an acquisition-year tripwire that suppresses every growth rate we compute in a year with material business-combination facts, and republishes only those the filing lets us state organically.
- **The non-GAAP ladder: CONFIRMED, and it is not in the 10-K.** The string "non-GAAP" appears zero times in both the MSFT FY2025 and CRM FY2026 10-Ks. It lives in the 8-K earnings-release exhibit — CRM's FY26 release headlines a 34.1% non-GAAP operating margin against a 20.1% GAAP margin, a 14-point ladder. We publish only GAAP, and the recommendation is a candor line and never a figure: state our GAAP margin, then note that the company's own release excludes stock compensation ($3,509M, 8.45 points) and acquired-intangible amortisation ($1.7B, 4.09 points) — built entirely from our own tags, explaining the gap without adopting the ladder.
- **Dual-class governance is structurally invisible, and the invisibility is the detector.** PLTR files no `dei:EntityCommonStockSharesOutstanding` in companyfacts at all, because it tags the cover-page count per class. Where that field is absent while `us-gaap:CommonStockSharesOutstanding` is present, raise a multi-class flag and route the class breakdown to the Notes pipeline. Do not infer voting power from anything in structured data.
- **RPO counterparty concentration: a genuine gap in the disclosure regime, not in our pipeline.** Oracle can truthfully say no customer was 10% of REVENUES while adding half a trillion of RPO, because the required test is aimed at the wrong balance. The concentration language is text-only. Where RPO/revenue exceeds roughly 3x, the honest structured-data companion is the capex-against-operating-cash-flow comparison, both figures filed. The counterparty question goes to the Notes pipeline, explicitly labelled as undisclosed.

---

## 6. COHORT HYGIENE — nearly half the shelf is not software

The Software shelf holds 250 rows. The audit flags 115 for relocation and four as ticker artifacts, leaving 131 distinct software issuers: a 47.6% reduction. Every proposed destination was verified to exist in the current taxonomy.

Largest groups, with the evidence that decided them: Alphabet, Meta, Pinterest, Snap, Match, IAC and thirteen others to **Interactive Media** (Meta files no RPO tag at all — the desk's machinery has nothing to bite on); Leidos, CACI, SAIC, Parsons and four others to **Aerospace & Defense** (Leidos files percentage-of-completion contract tags and no deferred revenue — a prime's balance sheet); EA, Take-Two, Roblox, NetEase to **Video Games**; AppLovin, Trade Desk, Magnite, Unity and eight others to **Advertising**; Block, Marqeta, Adyen, Lightspeed, Shopify to **Payments**; Flutter and Sportradar to **Casinos & Gaming**; Kyndryl, Capgemini, Rackspace, CoreWeave to **IT Services**; plus singles across fifteen further shelves.

Two structural findings beyond the list:
- **Video Games currently holds five members, all Japanese.** No US or ADR game publisher sits there; they are all stranded on Software. **Interactive Media holds four, of which two are Japanese** — every US interactive-media name is likewise stranded. These shelves are not sparse because the universe is sparse; they are sparse because SIC routing sends US filers elsewhere.
- **The Payments shelf the taxonomy defines is not where the payments companies are.** It holds only EEFT and LSAK, while V, MA, PYPL, FI, FIS and GPN sit on Commercial Services & Supplies. Any Block relocation should be decided together with that larger question, not ahead of it.

The largest inheritor of the desk's machinery is IT Services & Consulting, which after cleanup holds about 87 members and already contains genuine subscription software that leaked off Software the other way — WDAY, ZS, TOST, PEGA, VRSN, FIVN, RNG, GLOB — because SIC 7374 routes data-processing filers there. The leak runs both directions.

Judgment offered, for the owner's ruling: several proposed moves are genuinely contestable rather than clerical. Shopify to Payments, Unity and AppLovin to Advertising, Duolingo and Coursera to Education, and Tempus to Health Care Technology are all defensible either way. The clerical cases (defence primes, warrants, duplicate share classes) are not.

---

## 7. PROPOSED LINE SET (subject to ratification)

Ten lines, each with its gate. None ships without the gate passing.

1. `rpoTotal` — us-gaap, undimensioned, present at 12 of 15 filers. GATE: suppressed unless the band resolves (§3.1).
2. `rpoTwelveMonthShare` — Tier-2, three patterns, three gates (§3.2). Published as a fraction, never as derived dollars.
3. `contractLiability` — 606-generation stitched, contested years withheld (§2.2).
4. `sbcExpense` — `ShareBasedCompensation`, `/NetOfTax/` excluded.
5. `sbcShareOfOperatingCashFlow` — derived from two filed lines.
6. `dilutedShareChange` and `outstandingShareChange` — both, split-gated (§2.4).
7. `repurchaseCash` with convention flag — withholding-inclusive or not, per the identity test (§4).
8. `capitalizedContractCostNet` and `commissionsDeferredThisYear` — derived two ways (cash-flow net line, and year-over-year balance change) and required to agree before publishing.
9. `researchDevelopment` with a capitalisation companion — R&D is not comparable without it (§5).
10. `salesAndMarketing` as its own line, which is what F1 makes possible and is arguably the single most useful new number on a software page.

---

## 8. OPEN QUESTIONS — nothing is built until these are answered

**Q1 (F1, the biggest).** Ship reconstructed SG&A as sales-and-marketing plus general-and-administrative where the combined tag is absent, and withhold where only one leg exists? This changes a displayed row on roughly 130 software companies and on every filer elsewhere in the terminal that splits the two. Recommendation: yes, and add sales-and-marketing as its own line, because the customer-acquisition ratio is the number that answers whether growth was bought.

**Q2 (F2).** Apply the anchor-year staleness test to the merged record, not only to the fresh fetch? This will null a number of currently-displayed values pool-wide, replacing wrong numbers with honest blanks. Recommendation: yes, unreservedly — it is the doctrine, and it retires the whole resurrection-bug class.

**Q3 (F3).** Adopt the January 1-14 fiscal-year rule? Recommendation: yes; it is provably correct and provably narrow.

**Q4 (F4/F5).** Add the three named successor tags, with the depreciation caveat labelled on the cost-of-revenue variant? Recommendation: yes on R&D and netPPE without qualification; on cost of revenue, ship it with the basis labelled, or withhold if you would rather not carry a footnoted gross margin.

**Q5 (RPO gate).** Confirm the hard suppression: no total RPO without the twelve-month band. This means Oracle, the most spectacular RPO in the market, shows nothing until the Tier-2 parser reads its prose-only ladder — which it cannot, so Oracle shows nothing at all. Recommendation: confirm. The alternative is publishing $638B without the 12% that qualifies it.

**Q6 (typed-member parser).** Approve the three parser changes and their three gates? This is the first extension to the keyhole since it shipped, and it keeps blanket typed-refusal as the default.

**Q7 (the dilution ledger).** Approve the line set in §4, including showing both share-count measures and flagging the repurchase-tag convention? And should the un-mopped case (Oracle) read as its own labelled state rather than as a small buyback number?

**Q8 (split tripwire).** Treat any filer with a split-ratio fact as split-suspect and rebase per the integer-ratio test, or withhold the affected per-share series entirely until re-derived? Recommendation: withhold first, rebase second — a wrongly rebased series is a wrong number, a withheld one is not.

**Q9 (cohort hygiene).** Ratify the clerical relocations (defence primes, warrants, duplicate classes, the obviously-not-software names) as a block, and rule case by case on the contestable ones listed at the end of §6? And should the empty Video Games and Interactive Media shelves be populated in the same pass?

**Q10 (universe hygiene).** Collapse same-CIK ticker rows to one canonical record, and mark members whose latest 10-K is over about 15 months old? This is a terminal-wide change, not a software one.

**Q11 (capitalisation companion).** Ship the capitalised-software and capitalised-commission companions to R&D, given they are available at only some filers? A column that is present for SSNC and absent for PTC invites exactly the wrong inference unless the absence is labelled as policy rather than as missing data.

**Q12 (non-GAAP candor line).** Approve a candor line that names the company's own excluded items in dollars and points, without ever printing the non-GAAP figure itself?

---

## 9. WHAT WAS BUILT BEFORE RATIFICATION, AND WHY

Five items in §1 were wrong numbers on live pages rather than gaps, so they were repaired under the standing correctness mandate and are reported here rather than asked. Q1 through Q4 remain open on the JUDGMENT each involves; the arithmetic is no longer in doubt. Every tag was verified against filed data before any code was written.

Shipped: the SG&A reconstruction (F1), which moved 392 companies, 313 of them by more than ten points of revenue — this was never a software-only defect; the January-fortnight fiscal-year rule (F3), restoring Leidos's 2020 and Cadence's 2021; the R&D and net-plant successor tags (F4/F5), un-darkening Adobe and correcting Meta from $24.7B to $176.4B; and a full-pool re-fetch, which took companies carrying a stale non-zero current line from thousands to one.

Two further defects surfaced during verification and were repaired with them, neither software:
- **The cost-of-revenue scope conflict.** A near-synonym further down the chain can carry an order of magnitude more for the same year, which means the two elements are not the same scope. Caterpillar tags $49M under cost of goods and services sold beside $44,752M under cost of revenue, and first-tag-wins printed a 99.9% gross margin for a manufacturer. Where the gap exceeds tenfold the larger is now taken as the total and the promotion is logged; where it is narrow, chain order still decides, because that is a presentation choice and not a scope error.
- **The thin-cost floor.** Where no larger element exists to promote, a cost of revenue under a hundredth of revenue is withheld. CenterPoint, a utility that buys fuel, was printing a 100% gross margin from a $4M tag. Implausible gross margins across the pool fell from 91 to a residue that is structural (REITs and insurers, for which the concept does not apply).

Not shipped, and still Q4: the cost-of-revenue successor tag that would un-dark GoDaddy and others. It excludes depreciation and amortisation, so adopting it would quietly flatter gross margin at exactly the companies it fixes. It needs a labelled basis or it needs to stay withheld, and that is a presentation ruling.

Also filed, from the same verification: Expro Group is absent from the SEC's static ticker map, falls through to the live-resolution path, and returns no facts at all — it is now honestly withheld rather than sitting on a stale carried record. The live-resolution fallback deserves an audit of its own; it is not known how many others it silently fails.

## 10. THE COHORT-SCOPED FETCH (built 2026-07-22)

The desks work one shelf at a time and the fetch now can too: `FUND_INDUSTRY="Software"` covers 186 companies against the pool's 2,881, and `FUND_SECTOR="Information Technology"` covers 421. Membership resolves from the prior file's SIC through the same taxonomy the shelves use, so nothing is fetched to learn whether it belongs.

The discipline that had to come with it: partial runs are what produced F2 in the first place. Every partial run rewrites the whole file while touching only its cohort, and before the `fetchedAt` stamp nothing on a record said how old its extraction was. Making partial runs easier without that stamp would have industrialised the bug rather than the fix. `FUND_STALEST=n` is the safety valve — routine partial runs sweep the pool by age, so no company sits un-refreshed merely because nobody thought to name it.
