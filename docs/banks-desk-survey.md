# OWNERSCORECARD BANKS DESK — MERGED TAG CENSUS + DRAFT SPEC SKELETON

*Second analyst-desk filing under the desks strategy: four Berkshire-schooled agents surveyed eleven banks' XBRL disclosures across four size tiers, then a senior synthesis merged the census. Desk protocol: survey -> THIS SPEC -> owner review -> extraction code -> hostile verify -> ship. No extractor code exists yet; Section 6 lists the decisions that gate Bank Wave A. Pattern source: scripts/insuranceLines.mjs and docs/insurance-desk-survey.md.*

Evidence base: four tier surveys (11 filers). Tier shorthand used throughout:
- MC (money-center): JPM, BAC, C
- SR (super-regional): WFC, USB, TFC
- REG (regional): FCNCA, FLG (fka NYCB), FULT
- COM (community/niche): CBU, ESQ

Confidence scale: HIGH (standard tag, long undimensioned series, gate available) / MEDIUM (seam-stitch or per-filer chain required) / LOW (sparse, partial-scope, or per-filer map) / WITHHOLD (not extractable honestly from companyfacts).

All coverage below is undimensioned by construction (companyfacts drops dimensioned facts). "2026" in an instant range means a Q1-2026 10-Q balance.

---

## 1. TAG CENSUS

### 1.1 Deposits, total (existing pipeline line)
`Deposits`. MC: all three YE 2008-2025. SR: all three 2008-2025. REG: FCNCA 2009-2026, FLG 2008-2026, FULT 2009-2026. COM: CBU 2010-2025, ESQ 2016-2025. Confidence HIGH everywhere; serves as the checksum for the mix splits below.

### 1.2 Noninterest-bearing deposits (the moat made visible)
Per-tier tag chain required — the aggregate tag is NOT universal:
- `NoninterestBearingDepositLiabilities`: SR all three 2008-2025 (best coverage in the survey); REG FCNCA 2009-2026, FULT 2009-2026, FLG 2009-2013 + 2022-2026 (hole); COM CBU 2010-2025; MC only BAC and only YE 2024-2025.
- MC durable series is the pair `NoninterestBearingDepositLiabilitiesDomestic + ...Foreign` (JPM 2009-2025, BAC 2008-2025, C 2008-2025) with the exact-sum gate NIB(d+f) + IB(d+f) = Deposits verified to the dollar at all three (2024 diff $0).
- FLG hole bridge: `NoninterestBearingDomesticDepositDemand` 2008-2022, overlap equality exact at 2012 (2,758,840k) and 2022 (12,055,000k).
- ESQ never files the tag; its analog is `DemandDepositAccounts` (2016-2025), and Demand + `DepositsMoneyMarketDepositsAndNegotiableOrderOfWithdrawalNOW` + `TimeDeposits` = Deposits holds to the dollar at all 10 year-ends. Label ESQ's series "demand," not NIB.
Confidence HIGH at SR/COM/FCNCA/FULT, MEDIUM at MC (sum) and FLG (stitch), with exact identity gates available at every filer. 2024 checks: JPM NIB 619.3B of 2,406.0B; BAC 523.9B of 1,965.5B; C 207.7B of 1,284.5B.

### 1.3 Interest-bearing deposits (identity companion)
`InterestBearingDepositLiabilities`: SR WFC 2008-2025, USB 2010-2025, TFC 2009-2025; REG FCNCA/FULT 2009-2026, FLG 2022-2026 only; COM CBU 2010-2025, ESQ absent (implied). MC: aggregate only BAC 2024-2025; durable series is the Domestic+Foreign pair (JPM 2009-2025, BAC/C 2008-2025). Confidence HIGH/MEDIUM. Purpose: the NIB + IB = Deposits gate.

### 1.4 Time deposits and the uninsured-time sliver
- `TimeDeposits`: JPM/BAC 2010-2025, C 2022-2025 only; WFC 2009-2025, USB 2008-2025, TFC 2015-2025 (`TimeDeposits100000OrMore` 2009-2017 before); FCNCA/FULT 2010-2025, FLG 2008-2026; CBU 2010-2025, ESQ 2016-2025. Confidence HIGH except C (LOW, 4y).
- `TimeDepositsAtOrAboveFDICInsuranceLimit`: patchy at every tier (JPM 2015-2025, BAC 2017-2020, C 2021-2025; WFC 2020-2025, USB 2015-2021 stops pre-SVB, TFC 2016-2025; FCNCA 2021-2025, FLG 2022-2025, FULT absent; CBU's variant `TimeDepositLiabilityAboveUsInsuranceLimit` is MIS-TAGGED by four orders of magnitude — $5.0B at 2022/2023YE then $100k at 2024YE against $0.9-2.2B total time deposits; ceiling gate = TimeDeposits, withhold). Confidence LOW; time-deposits-only, never a full uninsured measure.

### 1.5 Brokered deposits (hot money dressed as franchise)
`InterestBearingDomesticDepositBrokered`: FLG 2009-2024 (16y, plus rare direct rate-paid tags `WeightedAverageRateDomesticDeposit*` [pure] 2009-2024), FULT 2016-2025, TFC 2023-2026. ABSENT all years: JPM, BAC, C, WFC, USB, FCNCA, CBU, ESQ. Confidence LOW where present, WITHHOLD elsewhere; the franchise-vs-hot-money test structurally needs FFIEC Call Reports for eight of eleven banks.

### 1.6 Interest expense on deposits (funding-cost numerator)
`InterestExpenseDeposits`: MC all three FY 2007/2008-2025; SR all three FY2007-2025; FCNCA/FULT 2008-2025; CBU 2009-2025. Confidence HIGH — the cleanest high-value line in the survey. Two exceptions:
- FLG: NEVER filed the total; only era-varying components with no total to gate a sum against. WITHHOLD FLG funding cost.
- ESQ: reconstruct as `InterestExpenseNOWAccountsMoneyMarketAccountsAndSavingsDeposits` + `InterestExpenseTimeDeposits` (both FY2015-2025); component sum + borrowings = total `InterestExpense` verified in all 9 overlap years. Confidence MEDIUM, gated sum.

### 1.7 Spread legs: interest income, interest expense, NII
- Total interest income `InterestAndDividendIncomeOperating`: full run at BAC, C, WFC, USB, TFC, FCNCA, FLG, FULT, CBU (2009-2025), ESQ (2015-2025). JPM needs a two-tag chain (`InterestAndDividendIncomeOperating` 2007-2011 -> `InterestIncomeOperating` 2010-2025, overlap 2010-2011 for the stitch gate). Confidence HIGH.
- Total interest expense: `InterestExpense` FY2007-2023 then FASB-deprecated -> `InterestExpenseOperating` FY2022-2025, at ALL tiers, overlap FY2022-2023 equal to the dollar everywhere tested — the textbook Wave A seam-stitch. ESQ 2024-2025: total absent, component-sum reconstruction (9/9 overlap years verified). Confidence HIGH (stitched).
- `InterestIncomeExpenseNet` (existing netInterestIncome line): full run at all eleven. Identity II − IE = NII holds to the dollar at every filer tested. Confidence HIGH; the existing line is sound.

### 1.8 Earning assets / average balances (NIM denominator)
NONE. No undimensioned earning-assets or average-balance tag exists at any of the eleven banks in any year — unanimous across all four surveys. The rate/volume and average-balance tables (the heart of the Wells-letter read) are text-only or dimensioned. FLAGGED CONFLICT: the MC survey allows NII/total-assets "labeled as such or withhold"; the SR and COM surveys say withhold outright, never approximate with total assets. Resolution is an owner decision (Section 6, Q1). Confidence WITHHOLD pending that decision.

### 1.9 Provision for credit losses — LIVE DEFECT in the existing line
Current chain (fetchFundamentals.mjs:258) = `ProvisionForLoanLeaseAndOtherLosses` -> `ProvisionForLoanAndLeaseLosses` -> `ProvisionForCreditLossExpenseReversal`.
- Tag 3 is ABSENT undimensioned at ALL ELEVEN banks, every year — verified independently by all four surveys. It is dead weight.
- Tag 1: continuous through FY2025 at JPM, WFC, USB, TFC, CBU (stitched with tag 2, all 8 overlap years equal); FCNCA 2012-2025; but DIED at BAC after FY2019 and C after FY2018, and never existed at FLG/FULT-post-2023 form.
- CONSEQUENCE, wrong numbers shipping today (MC survey, verified against the live extractor): fundamentals.json current-lines show BAC FY2025 provision 3.59B (actually the FY2019 value) and C FY2025 7.57B (the FY2018 value) — years-stale facts presented as current, while post-death history years are null. Actual FY2025 loans-only provisions: BAC ~5.6B, C ~9.5B.
- The recovery tags, agreeing exactly in every overlap year: `ProvisionForLoanLossesExpensed` (C 2007-2025 full run; FLG 2007-2013 + 2016-2025 — the tier-defining 62M/3M/133M/833M/1,092M/184M NYCB cycle, invisible to the current chain; FULT 2020-2025; JPM/BAC 2018-2021) and `FinancingReceivableExcludingAccruedInterestCreditLossExpenseReversal` (JPM/BAC 2020-2025, C 2021-2025). Off-BS component separately tagged: `OffBalanceSheetCreditLossLiabilityCreditLossExpenseReversal` 2018-2025 at MC, 2021-2025 CBU.
- SCOPE CAUTIONS: loans-only ≠ income-statement total (BAC 2020 10.565B vs 11.3B reported; C 15.922B vs 17.5B); BAC 2024 loans + off-BS = 5.821B vs reported 5.833B — a ~12M securities residual, so sum-of-parts is a gated approximation, not the filed line. C's pre-2019 tag-1 line includes policyholder benefits and claims (Citi's combined line) — cross-era comparisons at C mix scopes unless the loans-only series is used. FLG 2014-2015 (negative-provision years) survive under NO tag — withhold.
Confidence: HIGH after the chain fix, with per-scope labeling; currently BROKEN at BAC/C/FLG/FULT.

### 1.10 Charge-offs, recoveries, net charge-offs (the cycle record)
Three-era chains: `AllowanceForLoanAndLeaseLossesWriteOffs` -> `FinancingReceivableAllowanceForCreditLossesWriteOffs` -> `FinancingReceivableExcludingAccruedInterestAllowanceForCreditLossWriteoff` (+ parallel Recovery and WriteoffAfterRecovery/WriteoffsNet families). Every tested overlap year equals to the dollar.
- Continuous, honest: BAC 2009-2025; C 2008-2025; USB 2010-2025 (net 2012-2025, 2020 bridgeable gross − recoveries); FCNCA 2011-2025; FLG 2011-2025 (thin one-year stitch gate at 2022); FULT 2009-2025 (early era via `AllowanceForLoanAndLeaseLossesWriteOffs`).
- Holes/withholds: JPM 2012-2017 — the visible tag carries a PCI-pool subset (53-533M vs ~5B reality, ~30x wrong scope; magnitude gate mandatory; honest JPM coverage = 2008-2011 + 2018-2025, WITHHOLD between). WFC: dies after FY2021, nothing since (dimensioned-only; no custom-tag rescue). TFC: hole FY2011-2022, the entire BB&T/SunTrust integration. CBU: 2020 — the worst year of the decade — has NO undimensioned annual fact (absent-vs-zero discipline critical); nothing reliable after 2021. ESQ: `AllowanceForLoanAndLeaseLossesWriteoffsNet` 2015-2022 (genuinely net; rollforward closes to the dollar), nothing after.
- Traps: FULT `FinancingReceivableAllowanceForCreditLossWriteoffAfterRecovery` flips SIGN for comparative years inside a single filing (2023 = −29,072k and 2025 = +49,581k in the same 10-K) — sign-consistency gate required. WFC decoy `NetCreditLossOnLoansManagedOrSecuritizedOrAssetbackedFinancingArrangement` (FY2012-2025, 63M-scale) looks like an NCO series and is not — blacklist; NCO/loans ratio gate catches it. CBU subcategory leaks (784k vs 9.0M).
Confidence: HIGH at BAC/C/USB/FCNCA/FULT, MEDIUM at FLG, MEDIUM-with-mandatory-withhold-window at JPM, WITHHOLD WFC 2022+, TFC 2011-2022, CBU 2020 and 2022+, ESQ 2023+.

### 1.11 Allowance for credit losses balance — THE SEAM TAG
Chain: `LoansAndLeasesReceivableAllowance` -> `FinancingReceivableAllowanceForCreditLosses` -> `FinancingReceivableAllowanceForCreditLossExcludingAccruedInterest` (ESQ: `...Noncurrent` variant). Coverage exists at all eleven; FULT never migrated (one unbroken 2008-2026 series on the middle tag).
Four verified hazards, each with a required guard:
1. CONTAMINATED 2019-12-31 COMPARATIVES (MC): CECL day-one balances re-tagged AT 2019-12-31 in later filings' rollforwards — BAC 12.358B vs true pre-adoption 9.416B; C 16.541B vs true 12.783B. Most-recent-filed-wins ships the wrong number, and SEC frames (CY2019Q4I) pick the contaminated value too — frames cannot arbitrate this seam. Guard: same-date multi-value tripwire; at a known adoption seam prefer the value from the year's own 10-K (earliest filing at that date). JPM is clean (13.123B in all vintages).
2. SCOPE MIXING at one date: JPM 2019-12-31 carries 13.123B (loans-only) AND 14.300B (incl. unfunded); WFC/USB `FinancingReceivableAllowanceForCreditLosses` INCLUDES the unfunded-commitments reserve (WFC 10,456 vs 9,551 loans-only; USB 4,491 vs 4,020) while `LoansAndLeasesReceivableAllowance` is loans-only; FULT 291,940k vs 277,567k at 2020-12-31 (difference ≈ off-BS reserve); C parks 68-98M sub-scope facts under the tag. Guard: overlap-equality gates compare WITHIN scope only; magnitude gate (allowance ~0.5-3% of loans) catches every found instance.
3. FAILED/ABSENT OVERLAPS (COM): CBU's seam FAILS equality (2020YE 60.9M old vs 62.4M CECL tag; 2021YE 49.9 vs 50.7) — withhold at the seam, never average. ESQ has NO shared instant (old ends 2023-09-30, new begins 2023-12-31): a latest-instant-in-year reader on the old tag returns Sep-30's 15.3M when true YE is 16.6M under the new tag.
4. PRECISION DRIFT: FCNCA post-CIT filings re-tag prior years rounded to millions (225,141k vs 225,000k) — overlap gates need a declared-decimals rounding tolerance, not strict equality.
Confidence MEDIUM (chains + gates mandatory). Basis break note: day-one CECL step-ups (WFC 9,551->11,263, USB 4,020->6,216, TFC 1,549->5,211 — TFC's further inflated by merger PCD gross-up; pre-2020 TFC is BB&T-basis) mean allowance/loans must never be charted across 2019/2020 without a marked discontinuity.

### 1.12 Nonaccrual loans
`FinancingReceivableRecordedInvestmentNonaccrualStatus` -> `FinancingReceivableExcludingAccruedInterestNonaccrual`. Per-filer reliability, not per-tag:
- Publishable: BAC 2010-2025 (overlap 2021 equal, 4.567B both); USB 2010-2025 (overlap 2022); TFC 2010-2025 continuous; FULT 2010-2026 complete.
- Partial: WFC 2010-2016 + 2020-2022, dark 2023+; FCNCA 2010-2014 + 2019-2026 (hole 2015-2018; carries an explicit 2020-01-01 CECL transition instant 168,717k beside 2019-12-31's 121,689k — the confirmed banking analog of the insurance LDTI opening-instant trap); FLG 2022+ only (the bank whose 2023-2024 story WAS credit has no undimensioned nonaccrual record before 2022).
- WITHHOLD: JPM and C — never tagged undimensioned in any year (class-dimensioned only); CBU and ESQ — tag carries a mixture of subtotals and totals (CBU 2020: Q3 28.8M then YE 1.5M; ESQ alternates 4-7k with 5.8M and a frozen 10.9M across all 2024 quarters). Never proxy, never publish the unreliable series.

### 1.13 Loans held for investment (denominator for every credit ratio)
Three-era chain: `LoansAndLeasesReceivableNetOfDeferredIncome`/`...NetReportedAmount` -> `NotesReceivableGross`/`NotesReceivableNet` -> `FinancingReceivableExcludingAccruedInterestBefore/AfterAllowanceForCreditLoss` (ESQ: `...Noncurrent`). MC: every overlap equals to the dollar (JPM 2019 945.601B under all three tags). SR: WFC ends 2022 undimensioned (no successor — withhold 2023+); USB/TFC overlap-gated. REG: stitch overlaps FCNCA 2021, FLG 2022, FULT 2020-2023. COM: NO-OVERLAP seams at both banks (CBU old ends 2022Q1, new begins 2022YE; ESQ old ends 2023Q3, new begins 2023YE) — equality gate cannot run; a growth-plausibility gate must bless the stitch. DEAD-TAG INTERIM LEAK: dead tags keep emitting 10-Q quarter-end instants (BAC old tag's last fact 2020-06-30 = 998.944B; JPM HTM analog 2021-06-30) — the annual instant reader must pin to the fiscal-year-end DATE (12-31), not merely latest-in-year. Confidence MEDIUM-HIGH with gates.

### 1.14 Securities: HTM at cost, HTM fair value (the 2023 lesson), AFS
- HTM cost: `HeldToMaturitySecurities` -> `DebtSecuritiesHeldToMaturityExcludingAccruedInterest*` variants; overlaps equal where they exist (BAC 2021 674.591B both; C 2022 268.863B both; use Before-allowance variant for the gate — HTM allowance is 36-94M, sub-plausibility). TFC never migrated (2010-2026 one tag). FLG holds no HTM after 2017 (genuinely nothing to hide — record as n/a, not missing).
- HTM FAIR VALUE: `HeldToMaturitySecuritiesFairValue` — never deprecated, current at ten of eleven filers (JPM 2009-2025, BAC 2008-2025, C 2009-2025, WFC 2012-2026, USB 2008-2019 + 2021-2026, TFC 2011-2026, FCNCA 2018-2026 after a 2012-2017 hole, FULT 2018-2026, CBU 2021-2026, ESQ 2022-2026). `HeldToMaturitySecuritiesAccumulatedUnrecognizedHoldingLoss/Gain` runs 2013-2025 at MC, 2013-2026 WFC, 2018-2026 FCNCA/FULT. The unrealized HTM hole is DIRECTLY tagged: BAC 2022 = 108.596B (cost 632.9 vs FV 524.3 — checks exactly); JPM 2022 = 36.762B; C 25.316B; CBU 2024YE = −125.0M ≈ 14% of tangible common equity pre-tax. Zero derivation risk. Confidence HIGH — the highest-signal unused family in the census.
- AFS: fair value + amortized-cost chains survive at all eleven with gateable overlaps; accumulated gross unrealized loss tags present for the AOCI-drag view. FULT's AFS->HTM transfer (`DebtSecuritiesHeldToMaturityTransferAmount`) 2018 = 641,672k as-filed, re-tagged 0 in later comparatives — the mark-hiding maneuver caught in the filer's own inconsistency; prefer original filing, flag.

### 1.15 Tangible common equity components
- `StockholdersEquity` + `Goodwill`: full run at ten of eleven; TFC's parent-only equity tag has a 2010-2023 HOLE — use `StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest`. FLG goodwill 2,426,000k through Q3-2023 then 0 — the entire write-off visible undimensioned. ESQ: no goodwill/intangible tags at all — the honest absence of a de novo that never bought anything (n/a, not missing).
- Other intangibles: C 2011-2025 clean; USB 2008-2026; TFC 2009-2026 (FiniteLived); holes — JPM 2017-2021, BAC 2014-2019 (partially bridged by `FiniteLivedIntangibleAssetsNet`), WFC ends 2023, FULT patchy, CBU 2016-2024 (+FiniteLived deeper).
- Preferred (to reach COMMON equity — the missing pipeline line): JPM `PreferredStockIncludingAdditionalPaidInCapitalNetOfDiscount` 2009-2025; C `PreferredStockValue` 2008-2025; BAC hole 2014-2017. Not surveyed at SR/REG/COM — Wave A must inventory before shipping ROTCE there.
- Shares at year-end: FLG both Issued/Outstanding 2008-2026; FULT Issued 2009-2026 minus `TreasuryStockShares`; ESQ 2016-2026; CBU Issued 2010-2026 but treasury tag dies 2022; WFC us-gaap 2022-2026 only; FCNCA NONE — dual class A/B is dimensioned away, and dei `EntityCommonStockSharesOutstanding` is also absent undimensioned. dei cover-page shares (2009-2026 at SR) are filing-dated, not period-end — usable only with a dating caveat. Confidence: MEDIUM overall, WITHHOLD FCNCA year-end TBVPS.

### 1.16 Regulatory capital (gate-only per house rule)
- MC + SR: actual CET1/Tier 1/leverage are ABSENT undimensioned in the modern era (dimensioned under legal-entity/CapitalAdequacy axes, dropped by companyfacts; only pre-Basel-III scraps and minimum-requirement boilerplate survive; TFC carries nothing). Even gate-only cannot run. WITHHOLD.
- REG + COM: `CommonEquityTierOneCapitalRatio` [pure] FCNCA 2021-2025, FULT 2016-2025, ESQ 2016-2025; CBU 2013-2023 then STOPS undimensioned; FLG NEVER — and post-2017 NYCB has no undimensioned capital tags at all: the one bank that hit the regulatory wall has no undimensioned record of it.
- Traps: values are fractions of one (0.1299 = 12.99%) — scale gate mandatory; a filer can move the disclosure onto an axis mid-record (CBU FY2024) — ABSENCE MUST NOT READ AS FAILURE; treat as withhold, never as a failed gate.

### 1.17 Custom-namespace finding
NONE of the eleven banks carries bank-relevant extension tags in companyfacts (namespaces seen: us-gaap, dei, srt, invest, ffd, ecd — no bank lines). There is no custom-tag rescue for any hole: WFC's post-2022 credit disclosures, FLG's capital, JPM/C nonaccruals are unreachable from companyfacts, full stop. What varies is filer-idiosyncratic us-gaap tag CHOICE (ESQ's Noncurrent suffixes, DemandDepositAccounts, WriteoffsNet; CBU's legacy tags alive in the CECL era; FULT never migrating) — so Bank Wave A must be per-concept tag chains with per-filer aliases, exactly the insuranceLines.mjs architecture.

---

## 2. PROPOSED NEW LINES (minimal set, ranked by owner-value)

Fixes to EXISTING lines first (correctness campaign — wrong numbers shipping today):
- F1. provisionForCreditLosses (URGENT, live stale-number bug): BAC FY2025 shows 3.59B (a FY2019 fact) and C FY2025 shows 7.57B (FY2018) in current-lines; FLG's entire provision cycle is invisible. Fix: extend the chain with `ProvisionForLoanLossesExpensed` and `FinancingReceivableExcludingAccruedInterestCreditLossExpenseReversal` (overlap-equal everywhere tested); drop the never-present `ProvisionForCreditLossExpenseReversal`; label loans-only scope where the filed total is dead (BAC/C post-2019 — see Q3); withhold FLG 2014-2015. TRIPWIRE (generic, all lines): a chain tag whose latest FY < the record's FY must never populate the current-lines slot.
- F2. Annual instant reader (affects deposits, totalAssets, every instant line): pin to fiscal-year-end DATE, not latest-instant-in-year (dead-tag 10-Q leak: BAC loans 2020-06-30, JPM HTM 2021-06-30, ESQ allowance 2023-09-30); drop instant facts filed on duration concepts (FLG recovery mis-typing); same-date multi-value tripwire with prefer-own-year-10-K at known adoption seams (BAC/C 2019-12-31 contamination — frames CANNOT arbitrate, CY2019Q4I is itself contaminated).

New lines (name / tag sources / applicability / gate):
1. noninterestBearingDeposits — aggregate tag; MC via Domestic+Foreign sum; FLG via DomesticDepositDemand stitch; ESQ via DemandDepositAccounts (labeled "demand"). All eleven. Gates: NIB + IB = Deposits exact-sum (verified to the dollar at MC, CBU 16/16, ESQ 10/10); overlap equality at FLG's stitch. The single highest-value bank addition — the moat made visible, 16-18 years everywhere.
2. interestExpenseDeposits — single tag, full run at nine filers. ESQ: gated component sum. WITHHOLD FLG (no total, never sum ungated). Gate: ≤ total interest expense; component-sum equality where used.
3. netChargeOffs (grossWriteoffs, recoveries, net) — three-era chains per 1.10. Applicability: BAC, C, USB, FCNCA, FLG, FULT, ESQ(pre-2023), CBU(pre-2020), JPM(with 2012-2017 withhold window). Gates: overlap equality per seam; MAGNITUDE gate NCO/loans (kills the JPM PCI trap and WFC decoy); sign-consistency gate (FULT); recoveries ≤ writeoffs; rollforward closure where allowance chain closes. WITHHOLD: WFC 2022+, TFC 2011-2022 — displayed with the reason.
4. allowanceForCreditLosses — scope-aware chains per 1.11 (loans-only scope as primary; +unfunded scope tracked separately, never mixed). All eleven. Gates: within-scope overlap equality with declared-decimals tolerance; adoption-seam guard; allowance 0.5-3% of loans; withhold-never-average at failed seams (CBU 2020-2021).
5. loansHeldForInvestment — three-era chain per 1.13. All eleven (WFC ends 2022). Gates: overlap equality; growth-plausibility at no-overlap seams (CBU/ESQ); FYE-date pinning.
6. htmFairValue + htmAmortizedCost (and the unrecognized-loss companion where tagged) — per 1.14. Ten filers (FLG n/a post-2017, recorded as n/a). Gates: FV − cost = tagged unrecognized loss where all three exist (BAC 2022 checks exactly); Before-allowance variant for cross-era equality.
7. totalInterestIncome + totalInterestExpense — spread legs per 1.7 (JPM two-tag chain; InterestExpense seam-stitch; ESQ component sum). All eleven. Gate: II − IE = NII to the dollar (holds everywhere tested).
8. timeDeposits — single tag mostly. Gate: ≤ Deposits. C pre-2022 LOW. The hot-money mix signal (CBU 7%->16% in the 2023-2024 rate scramble).
9. preferredEquity — per-filer tags per 1.15; enables tangible COMMON equity. Withhold years in the BAC 2014-2017 hole; inventory SR/REG/COM before shipping.
10. nonaccrualLoans — per 1.12, PER-FILER applicability list (BAC/USB/TFC/FULT full; WFC/FCNCA/FLG partial; JPM/C/CBU/ESQ WITHHOLD). Gate: continuity + magnitude vs loans; the CBU/ESQ subtotal-mixing is the exhibit for why per-filer reliability gating exists.
11. sharesOutstandingFYE — per-bank map per 1.15 (issued-minus-treasury at FULT; equity-tag choice at TFC). WITHHOLD FCNCA (Q5).
12. brokeredDeposits — FLG/FULT/TFC only; n/a-vs-missing schema distinction for the other eight (structurally untagged, not zero).
13. cet1Ratio (gate-only, never the shipped headline) — REG/COM where tagged; ×100 scale gate; absence = withhold, never failure. MC/SR structurally impossible (Q7).
14. offBalanceSheetCreditReserve — `OffBalanceSheetCreditLossLiability` (MC 2017-2025, +CBU) — needed to reconcile provision scopes and allowance scope diffs; BAC carries the textbook dual-value 2019-12-31 exhibit (813M vs 1.123B).

---

## 3. THE DERIVED READINGS (each with its withhold conditions)

1. DEPOSIT FRANCHISE QUALITY — NIB share = noninterestBearingDeposits / Deposits, yearly, 16-18y at all eleven (ESQ labeled demand share). The Buffett-reads-Wells number. Withhold: FLG 2014-2021 only if the stitch gate ever fails (it currently passes exactly). Companion: time-deposit share (hot-money drift).
2. COST OF DEPOSITS — InterestExpenseDeposits / deposit balance. NO average-balance tag exists: denominator is the average of the two year-end instants, PUBLISHED WITH THE BASIS LABELED (the MC survey used avg-of-YE-pair; the SR survey insists on labeling, never calling it the true cost — convention decision Q11). Withhold: FLG (no numerator). Through two rate cycles this prices the franchise: ESQ funds at ~40% demand share with $3-5k of borrowing interest; CBU's 2023-2024 scramble is visible.
3. NIM — WITHHELD as a to-filing-precision number at all eleven (no earning-asset denominator exists, unanimous). Open question Q1 decides whether a labeled NII/period-end-total-assets proxy ships at all. Never silently substitute total assets.
4. NET CHARGE-OFF RATE — netChargeOffs / loansHFI (same YE-pair-average convention). Coverage per 1.10; Graham's worst year is inside coverage at BAC, C, USB, FCNCA, FULT (2009-2011) and FLG (2023-2024). Withhold windows displayed, not blanked: JPM 2012-2017, WFC 2022+, TFC 2011-2022, CBU 2020 and 2022+, ESQ 2023+ — "the worst year counts" fails silently unless absent ≠ zero.
5. UNDER-PROVISIONING TEST (the desk's reason to exist) — cumulative provisions vs cumulative NCOs across the cycle; the reserve-release year is the exhibit (2021 provisions: JPM −9.3B, BAC −4.2B, C −3.1B). Honest ONLY where both series are complete over the window: USB, BAC, C, FCNCA, FULT (and JPM 2018-2025 window-scoped). WITHHOLD WFC and TFC entirely, and say why. COM survey proposes implying post-CECL NCOs from allowance(t−1) + provision − allowance(t) — conflicts with withhold-never-guess where the allowance seam is broken; Q10 decides, and it is only even arguable where the allowance chain closes cleanly.
6. ALLOWANCE COVERAGE — allowance / loansHFI, loans-only scope both sides. MANDATORY marked discontinuity at 2019/2020 (CECL step-up; TFC additionally merger-basis — pre-2020 TFC not comparable at all). Withhold at failed seams (CBU 2020-2021).
7. HTM MARK VS TANGIBLE EQUITY (the 2023 lesson) — (htmFairValue − htmAmortizedCost) set beside tangible common equity, pre-tax labeled. Pure arithmetic on existing facts at ten filers; the single highest-signal addition after the deposit franchise (BAC 2022: −108.6B; CBU 2024: ~14% of TCE). n/a at FLG (no HTM). Companion: AFS accumulated unrealized loss (already in equity — never double-count).
8. TANGIBLE BOOK PER SHARE + ROTCE (the compounding scoreboard) — (SE − preferred − goodwill − other intangibles) / FYE shares. Withhold the ratio for ANY year missing a component: JPM intangibles 2017-2021, BAC intangibles 2014-2019 + preferred 2014-2017, WFC intangibles and shares 2024+, FCNCA all years (no share count), TFC only via the NCI-inclusive equity tag (labeled). A silently wrong denominator is worse than a blank.
9. EFFICIENCY RATIO — noninterestExpense / (netInterestIncome + noninterestIncome). Computable TODAY from existing lines, full history, all eleven. The cost-culture readout is free.

---

## 4. SURFACES

- Deposit-franchise panel (WS2 terminal, bank pages): 18-year NIB-share strip, cost-of-deposits line through two rate cycles (basis labeled), time-deposit and brokered share where tagged — franchise vs hot money on one surface.
- Credit-discipline panel: signed NCO-rate strip with withhold windows SHOWN as withheld (not blank); provisions-vs-NCO cumulative track (the under-provisioning meter); allowance coverage with the CECL discontinuity marker; 2021 release year visible against 2020 build.
- Tangible-book-quality panel: TBVPS growth scoreboard; HTM mark beside TCE (the SVB blindness, cured); AFS AOCI drag; goodwill share of book (CBU-the-acquirer vs ESQ-the-de-novo is the Munger inversion in miniature).
- Peer metrics (src/lib/peers.mjs): NIB share, cost of deposits, efficiency ratio, NCO rate, allowance coverage, ROTCE — all with per-filer n/a-vs-withheld rendering.
- Almanac criteria: worst-year NCO rate (Graham), through-cycle cost of deposits, NIB-share floor, cumulative provision/NCO ratio, TBVPS CAGR.
- Correctness-campaign tripwires: stale-chain-tag current-lines guard (F1), FYE-date pinning, same-date multi-value, magnitude/sign/scale gates, dark-series warns (WFC credit, CBU capital) join the existing continuity/identity audits.

---

## 5. RISKS & WITHHOLDS

1. THE CECL-2020 SEAM PRESENTS DIFFERENTLY PER TIER — all four modes must be handled, none generalizes: (a) MC: contaminated 2019-12-31 comparatives (BAC/C) with frames contaminated too; (b) SR: NO same-date conflicts (that claim is tier-scoped, like the insurance MEGA-PC written-premiums claim — do not generalize it), hazard = basis break + per-bank migration years (USB 2022, TFC 2023, WFC never); (c) REG: explicit Jan-1 transition instants (FCNCA 2020-01-01) — the confirmed LDTI-opening-instant analog — plus mis-typed instants on duration concepts (FLG); (d) COM: no Jan-1 instants at all, hazard = tag succession with failed (CBU) or absent (ESQ) overlaps. FULT's adoption timing was NOT verified from XBRL alone — stays OPEN, withhold.
2. companyfacts drops ALL dimensioned facts — structural, verified: average balances/NIM everywhere; modern CET1 at MC/SR; nonaccruals at JPM/C; WFC's entire credit block post-2021/2022; TFC charge-offs 2011-2022; post-CECL rollforwards at COM; FCNCA share count (dual class); FLG capital post-2017. NO custom-namespace rescue exists at any of the eleven (1.17). Wave B = inline-XBRL/R-file parsing with an auditable dimension-acceptance rule; until then these are honest withholds with the reason displayed.
3. Wrong-scope facts under the right tag: JPM's PCI-sliver writeoffs (~30x small), WFC's managed-loans decoy, C's policyholder-benefits-inclusive provision, C's 68-98M allowance sub-scope facts, CBU's $5.0B/$100k uninsured-time mis-tag, CBU/ESQ nonaccrual subtotal mixing. Per-line magnitude plausibility gates are not optional at any tier; they are the difference between a record and a rumor.
4. Holding-company vs bank-subsidiary scope traps: FLG's companyfacts entityName now reads FLAGSTAR BANK, NATIONAL ASSOCIATION — the CIK's filer identity shifted toward the bank entity; capital was tagged on a parent/bank axis (dropped); TFC's parent-only StockholdersEquity has a 2010-2023 hole (use the NCI-inclusive tag, labeled). Any bank line must state which entity's record it is; regulatory ratios in particular differ parent vs bank.
5. Dead tags leak interim instants (JPM HTM 2021-06-30, BAC loans 2020-06-30, ESQ allowance Sep-30) — latest-END-in-year alone ships a June balance as an annual figure; FYE-date pinning is mandatory and is a REPAIR to the insurance-era instant rule, not a copy of it.
6. Restatement behaviors inside single filings: FULT's NCO sign flips and its 641,672k->0 HTM-transfer re-tag; FCNCA's millions-rounding of prior years. Guards: sign-consistency, declared-decimals tolerance, prefer-original-filing with conflict flag.
7. Structurally n/a vs missing must be schema-distinct: ESQ goodwill (never bought anything), FLG HTM post-2017 (holds none), life-style absences do not apply here but brokered/uninsured tags absent ≠ zero hot money; CBU capital tags going dark ≠ capital failure.
8. Out of XBRL entirely (text or Call Reports, all filers): average balances and true NIM/deposit betas (FLG's rate tags are the lone exception), uninsured deposits (the 2023 run fuel), brokered deposits at eight of eleven, reg capital at MC/SR, and Fisher's candor test on credit mistakes (e.g., FLG's FY2023 10-K/A and material-weakness disclosures) — the tagged record must be paired with the filed text, not pretended sufficient.
9. Redefinition/correction exposure: F1 changes numbers already public for BAC and C (current provision lines). Ships under the correctness campaign as a correction, per Q2.

---

## 6. OPEN QUESTIONS FOR THE OWNER

1. NIM: blanket withhold (SR/COM position), or publish NII / period-end total assets as an explicitly-labeled proxy (MC position)? The surveys genuinely conflict; doctrine (withhold, never guess) leans withhold, but the labeled proxy is arithmetic on sound facts.
2. The F1 provision fix corrects live wrong numbers at BAC and C — ship as a correctness-campaign correction note (precedent: LHX-class warns), confirm.
3. Where the filed income-statement provision total is dead (BAC/C post-2019): publish the loans-only series labeled as such, the gated sum-of-parts (~12M residual at BAC 2024), or withhold the total and show components? House doctrine says never present a rebuilt line as the filed one.
4. WFC shows four-plus recent years of WITHHELD credit record (the largest SR bank): accept for Wave A, or does WFC's visibility gate Wave B (dimensioned parsing) the way TRV's development line gated insurance?
5. FCNCA TBVPS: withhold entirely (no year-end share count exists undimensioned), or publish a weighted-average-share variant clearly labeled non-standard?
6. dei cover-page share counts (filing-dated, not period-end) as a labeled fallback at WFC — acceptable, or withhold?
7. CET1 gate-only displays would exist ONLY at REG/COM filers (structurally impossible at MC/SR) — accept the cohort asymmetry with an explanation line, or suppress tier-wide for comparability?
8. Under-provisioning meter: cumulative-from-2008 vs rolling-10y window, and publish only where both series are gap-free (USB/BAC/C/FCNCA/FULT), withholding JPM (window), WFC, TFC, CBU, ESQ?
9. Implied post-CECL NCOs from the allowance identity where direct facts are dimensioned-only (COM proposal) vs withhold-never-guess (house rule) — which binds? Recommend: withhold; the identity becomes a GATE on direct facts, never a source.
10. Ratio denominators: adopt average-of-two-year-end-instants as the house convention (labeled), for cost of deposits and NCO rate alike?
11. New-shelf gate: the bank shelf requires shelves.json + groupingColumns work per the terminal mandate (tier groupings: money-center / super-regional / regional / community) — confirm in scope before extraction lands.
12. Brokered/uninsured deposits: leave XBRL-blind with an explicit "lives in Call Reports" caveat, or is FFIEC data a sanctioned future source for the desk?

Evidence files referenced by the surveys (scratchpad C:/Users/ryanr/AppData/Local/Temp/claude/c--Users-ryanr/6d6f1b58-2746-4214-95da-20156eb83cfd/scratchpad): cf_mc_{JPM,BAC,C}.json + mc-inventory2.mjs + mc-inv2.txt + mc-drill*.mjs (MC); {wfc,usb,tfc}.json + banksurvey.mjs + bankprobe*.mjs (SR); cf-bank-{FCNCA,FLG,FULT}.json + banks-inventory-out.txt + banks-inventory.mjs + banks-drill.mjs (REG); COM per its survey. Pipeline anchors: C:/Users/ryanr/.surplus-scout/ownerscorecard-terminal/scripts/fetchFundamentals.mjs lines 255-260 (bank CONCEPTS; the broken provision chain is line 258), pattern module C:/Users/ryanr/.surplus-scout/ownerscorecard-terminal/scripts/insuranceLines.mjs, format source C:/Users/ryanr/.surplus-scout/ownerscorecard-terminal/docs/insurance-desk-survey.md.
