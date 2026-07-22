# Insurance desk — phase-1 survey (2026-07-21)

*The first analyst-desk filing under the desks strategy: eight Berkshire-schooled agents surveyed
eighteen insurers' XBRL disclosures (six subtype groups across the size spectrum, plus a
text-conventions read of the loss-development tables), then a senior synthesis merged the census.
Product of the desk protocol: survey -> THIS SPEC -> owner review -> extraction code -> hostile
verify -> ship. No extractor code exists yet; Section 6 lists the decisions that gate Wave A.
Survey run wf_260fa20c-c4c; evidence inventories were session-scratchpad files, summarized here.*

# OWNERSCORECARD INSURANCE DESK — MERGED TAG CENSUS + DRAFT SPEC SKELETON
Evidence base: six subtype surveys (18 filers) plus one filing-text-conventions survey. Subtype shorthand used throughout:
- MEGA-PC: CB, AIG, TRV
- PERS: PGR, ALL, AIZ
- SPEC-RE: ACGL, MKL, RNR
- SMALL-PC: UFCS, HRTG, NODK
- MEGA-LIFE: PFH(PRU), MET, ATHS
- MID-LIFE: LNC, VOYA, GL

Confidence scale: HIGH (standard tag, long undimensioned series, gate available) / MEDIUM (seam-stitch or fallback chain required) / LOW (sparse, partial-scope, or per-filer map) / WITHHOLD (not extractable honestly from companyfacts).

---

## 1. TAG CENSUS

### 1.1 Float component: loss reserves
- GROSS: `LiabilityForClaimsAndClaimsAdjustmentExpense` (current pipeline lossReserves, fetchFundamentals.mjs:280). Coverage: all P&C 13-18y (CB 15, AIG 16, TRV 18, PGR 15, ALL 9 + variant `...PropertyCasualtyLiability` 16y, AIZ 14, ACGL 16, MKL 17, RNR 17, UFCS 15, HRTG 14, NODK 13). Predecessor `ReserveForLossesAndLossAdjustmentExpenses` backfills PGR/AIZ/ACGL 2008-2012. Life: MET 15y; PFH absent (folded into combined FPB tag); ATHS absent (genuinely no claims liability); LNC dead after 2022. Confidence HIGH as a tag, but WRONG-SIDED as float for cedents (HRTG FY2024 gross 1,042.7M vs net 367.0M — shipped float ~3x investable float).
- NET: `LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseNet`. Coverage: CB 19y, AIG 18y, TRV 10y, PGR 19y, ALL 6y (STOPS 2020), AIZ 13y, ACGL/MKL/RNR 18y each (longest series in the whole insurance inventory per SPEC-RE survey), UFCS 17y, HRTG 14y, NODK 13y, MET 19y, PFH 2009-2022 then dark. Confidence HIGH except ALL post-2020 and PFH post-2022.
- Identity gate available and verified exact: gross = net + recoverable-on-unpaid (NODK 2023: 217.1 = 168.2 + 49.0).

### 1.2 Float component: unearned premiums (the largest un-extracted component)
- `UnearnedPremiums`: MEGA-PC 18y all three; PERS 18y all three; SPEC-RE 17y all three; SMALL-PC 16/14/11y. Life: primary tag GL only (18y, $0.27B); Schedule III fallback `SupplementaryInsuranceInformationUnearnedPremiums` PFH 18y, MET 16y, VOYA 14y, LNC 10y sparse; ATHS genuinely absent. Confidence HIGH for P&C, LOW/immaterial for life.
- Materiality proof: AIZ carries $20.9B UPR against $2.1B loss reserves — its float is 10x invisible today; CB drops $26.3B, PGR $25.2B, TRV $22.4B.

### 1.3 Float component: future policy benefits (life)
- `LiabilityForFuturePolicyBenefits`: CB 18y ($18.4B, Huatai-driven), AIG 16y, GL 18y ($19.2B), MET 18y, PFH 17y, ATHS 7y, MKL 14y (runoff, <2% of float), LNC 7y, VOYA 4y, ALL/AIZ shrinking remnants post-divestiture, TRV/PGR/RNR/ACGL correctly absent.
- Continuity backbone: combined tag `LiabilityForFuturePolicyBenefitsAndUnpaidClaimsAndClaimsAdjustmentExpense` — PFH 18y (his actual balance-sheet line), LNC 18y, VOYA 14y, GL 11y. Post-LDTI it equals pure FPB at LNC/VOYA (identical FY25 values) so the splice is gateable: FPB <= combined. Confidence MEDIUM (splice required for LNC/VOYA/PFH history).
- Trap: NODK's combined tag is really its P&C reserve line and was re-presented ex-divested for 2022-23 comparatives (217.1 vs 119.2 at the same date).

### 1.4 Float component: policyholder deposits / account balances
THREE different us-gaap elements for one concept; per-filer element map mandatory:
- `PolicyholderContractDeposits`: MET 18y, PFH 15y, VOYA 14y, ATHS 7y (verified = Athene's interest-sensitive contract liabilities, its dominant float), AIG 2008-2023 (ends at Corebridge, $162B), ALL 17y, CB 2008-11 only.
- `PolicyholderFunds`: LNC 18y ($136.3B — 3x its FPB), CB 5y 2021-25 ($8.6B), dual-tagged at VOYA/MET/PFH 2021+.
- `OtherPolicyholderFunds`: GL 18y ($0.5B, trivial), AIG 18y.
- The LDTI level tag `PolicyholderAccountBalance` appears in NO filer's default context (grep-confirmed in PERS; corroborated MEGA-PC, MID-LIFE). Only rollforward FLOWS surface, and only at CB (2021-25) and ATHS (2022-25, uniquely complete undimensioned).
- CB seam: ContractDeposits (2008-11) → PolicyholderFunds (2021-25) with a 2012-2020 gap where NEITHER is tagged — withhold the gap years. Confidence MEDIUM overall, LOW at CB pre-2021.

### 1.5 Float exclusion: separate accounts
- `SeparateAccountAssets` / `SeparateAccountsLiability`: LNC 18y ($180.1B), MET 18y, PFH 18y, VOYA 14y ($113.0B), AIG 2008-2023, CB 5-6y, ALL to 2020, AIZ to 2021; ATHS/TRV/PGR/SPEC-RE/SMALL-PC genuinely absent. Confidence HIGH.
- Must be EXCLUDED from float and from investable assets (pass-through; policyholder bears investment risk). Naive liability-summing roughly doubles MET float; LNC/VOYA leverage off totalAssets is wrong by ~half the balance sheet. Free gate: assets ≈ liability within rounding. ATHS's absence is a correct, checkable fact — schema must distinguish n/a from missing.

### 1.6 Float component: market risk benefits (LDTI, 2021+)
- `MarketRiskBenefitLiabilityAmount` (+Asset): PFH 5y, MET 5y, ATHS 4y, LNC 4y. VOYA: dimensioned-only, invisible to companyfacts despite being on its balance sheet — withhold. Confidence MEDIUM (short series, LDTI-only).

### 1.7 Float deductions (Buffett's subtraction side)
- Premiums receivable `PremiumsReceivableAtCarryingValue`: CB 18y, TRV 18y, PGR 18y ($15.4B — material), ALL 18y, AIZ 15y, ACGL 17y, RNR 17y, UFCS 16y, HRTG 13y. FAILS: AIG (only polluted `PremiumsAndOtherReceivablesNet`), MKL (combined tag only), NODK (4y; fallback polluted), GL/PFH/ATHS absent, LNC stopped 2021, VOYA 8y with a NEGATIVE FY2022 value (gate exhibit: reject negatives, reject stale). Confidence HIGH where present, WITHHOLD where polluted/absent.
- DAC balance `DeferredPolicyAcquisitionCosts`: 17-19y at most P&C and GL/PFH; combined DAC+VOBA variants required at ALL (19y), UFCS (17y), LNC (16y), VOYA (16y), MET (19y) — flag definitional impurity. ATHS dark after 2022 (moved to custom `ahl:` tag). Materiality: AIZ DAC $10.2B ≈ half its UPR — skipping the deduction roughly DOUBLES AIZ float; GL DAC $7.0B = 37% of reserves. Confidence HIGH/MEDIUM; ATHS post-2022 WITHHOLD.
- Prepaid reinsurance `PrepaidReinsurancePremiums`: CB/TRV/PGR 18y, SPEC-RE 17y all three, UFCS 16y, HRTG 13y (~$307M vs $707.9M UPR — material). ABSENT: ALL, AIZ, AIG; NODK 2y only. Confidence HIGH where present.

### 1.8 Premiums written vs earned (the discipline line)
- Earned `PremiumsEarnedNet`: near-universal, deepest insurer line (19y at 10+ filers). PGR needs seam with `PremiumsEarnedNetPropertyAndCasualty` (overlap verified equal to the dollar). Already extracted. HIGH.
- Written `PremiumsWrittenNet`: CB 19y, TRV 18y, PGR 18y (internally exact: direct − ceded = net to the dollar), ACGL 18y, MKL 17y, RNR 18y, HRTG 12y. Fallback lane `SupplementaryInsuranceInformationPremiumsWritten` (Sch III): UFCS 16y (verified identical to face tag in EVERY overlap year), AIG 17y (face tag died 2016; splice needs 2011-16 overlap seam gate), ALL 18y (only consolidated series; FY2024 60,367 vs earned 58,309 — plausible), PGR 18y (equals face tag to the dollar).
- HARD WITHHOLDS: AIZ (Sch III written is P&C-scope only — 3,601 written vs 10,483 earned FY2025; publishing the ratio would be a wrong number), NODK post-2021 (all written tags stop), LNC post-2022, GL/PFH/ATHS never (life filers do not report written premiums — the concept is structurally n/a for the life subtypes; never impute). Life substitute inflow: deposits bypass revenue — VOYA gross pair `AdditionsToContractHoldersFunds`/`WithdrawalFromContractHoldersFunds` 15y, GL net-only 19y, ATHS rollforward 2022+, LNC NONE.
- Direct/assumed/ceded splits (written and earned): CB 18y, TRV 15y, PGR 18y (written), SPEC-RE 17y written / 15y earned, HRTG 12-13y (incl. the only SMALL-PC `PremiumsWrittenGross`), Sch IV earned splits 12-15y at all life filers. Identity gate: direct + assumed − ceded = net.
- FLAGGED PHRASING CONFLICT: MEGA-PC survey states "no PremiumsWrittenGross tag exists for any filer" — true only for its trio; SPEC-RE (ACGL 15y, MKL 14y, RNR 15y) and HRTG (13y) do carry it. Treat the MEGA-PC claim as trio-scoped.

### 1.9 PRIOR-YEAR RESERVE DEVELOPMENT (the honesty meter — highest-value missing line, unanimous across all six surveys)
Primary: `SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense` (+ CurrentYear companion, same coverage). Predecessor lineage `LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaimsPriorYears` (2008-2013, dies at the ~2015 FASB deprecation seam). Corroborator: `SecSchedule1218Supplemental...` (CB 2016-25, agrees within rounding — a self-validating pair).
- Coverage Tier 1 (undimensioned, extract now): CB 18y continuous; PGR 18y; ALL 18y; AIZ 12y; ACGL/MKL/RNR 14y each, extendable to 2009 via predecessor with overlap; UFCS 14y; HRTG 14y; NODK 12y; MET 14y (SCOPE CAVEAT: short-duration group book only, not enterprise); AIG spliced 2009-12 + 2018-25 with a 2013-17 HOLE covering exactly the $5.6B 2016 adverse charge — the silence is itself the story; frames CY2024 show ~101 undimensioned filers economy-wide.
- Tier 2 (tagged in the filing but DIMENSIONED, invisible to companyfacts): TRV (FY2025 = −939M, dimension srt:ProductOrServiceAxis = PropertyLiabilityAndCasualtyInsuranceSegmentMember; also Berkshire, RLI, Hartford per frames absence). Requires inline-XBRL/R-file parsing with one auditable dimension-acceptance rule — pipeline work, not per-company maps. NOTE: MEGA-PC survey's "TRV: NOTHING after 2012" and the conventions survey's "present but dimensioned" are the same fact seen through two lenses, not a conflict.
- Never/withhold: LNC (never tagged, any year — and this is a filer with repeated assumption charges; surface the absence), GL (stopped 2018), VOYA (3y, stop-loss block only), PFH, ATHS.
- Sign convention UNIFORM where tagged: negative = favorable, positive = unfavorable (verified independently by four surveys). Trap: TRV's custom headline tag `trv:NetFavorablePriorYearReserveDevelopmentImpactingResultsOfOperations` has the sign FLIPPED and differs from the GAAP line by discount accretion (1.04B vs 939M) — anchor on the standard tag, treat custom as enrichment, trust the signed fact never the adjective.
- Gates, all verified feasible: (a) identity CY incurred + PY development = total incurred (exact on PGR FY2024: 49,476 − 416 = 49,060); (b) scope gate — rollforward begin/end net reserves must reconcile to balance-sheet reserves within tolerance, else label sub-book or withhold (MET and health-insurer filers fail enterprise scope); (c) continuity gate across the deprecation seam; (d) sign from XBRL fact only.
- Life analog: `LiabilityForFuturePolicyBenefitRemeasurementGainLoss` — MET 5y, ATHS 5y, LNC 5y; PFH dimensioned-only; VOYA/GL dimensioned-only. 2021+ only. Confidence MEDIUM.

### 1.10 Reserve rollforward (gate inputs and cash check)
`LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaims1`, `...ClaimsPaidCurrentYear1/PriorYears1`, `PaymentsForLossesAndLossAdjustmentExpense`: 12-14y at CB, AIG, PGR, SPEC-RE (all three), SMALL-PC (all three); ALL 4-9y; TRV dimensioned; MET 14y. Enables independent recomputation of the development line and a paid-to-incurred gate before shipping either; where they disagree, withhold and flag. Also the verified stitch source for MKL's dead claims line (overlap 2022-23 equal to the dollar).

### 1.11 Reinsurance (counterparty risk on the float)
- Recoverables: continuous 2008-25 at most filers only by stitching 2-3 generations (`ReinsuranceRecoverables` legacy → `ReinsuranceRecoverableForUnpaidClaimsAndClaimsAdjustments` / `ReinsuranceRecoverablesOnPaidAndUnpaidLosses`). Per-splice seam gates required. Traps: ALL consolidated recoverable DARK after 2020 (allowance only — dependence goes dark exactly when leaned on); UFCS tag drift (legacy tag silently became a $14.2M paid-sliver while the real $213.6M unpaid recoverable moved tags); GL has NO recoverable tag but genuinely cedes almost nothing — distinguish "cedes nothing" from "not tagged" via presence of `CededPremiumsEarned` (GL 14y).
- CECL allowance `ReinsuranceRecoverablesAllowance`: 6-14y at most (2019/2020+); the allowance trend is Fisher's candor test in numbers.
- Owner ratios buildable: recoverables/equity (flag > 1x: LNC $28.0B exceeds equity severalfold; HRTG's $675.7M towered over equity), ceded-written/gross-written (HRTG ~44%), ceded-earned share where written missing (15y at most).
- Funds held / modco / towers / reinstatements / retentions: ragged-to-absent (ATHS funds-held liability 3y, asset dark; LNC 18y, VOYA 13y; retention tags 1-6y scattered). Text only.

### 1.12 Underwriting expense and ratios
- No single-tag full expense load at ANY filer except PGR (`OtherUnderwritingExpense` 19y — the only filer whose combined ratio is fully XBRL-computable for the whole record). UFCS 17y and NODK 12y carry the tag; MKL carries it WITHOUT acquisition costs; CB/AIG/TRV/ACGL/RNR never tag it — the pipeline's underwritingExpense silently degrades to DAC amortization alone (~half an expense ratio presented as whole). HRTG needs DAC amortization + SG&A (different composition). Sch III `SupplementaryInsuranceInformationOtherOperatingExpense` is the nearest fallback (17-18y widely).
- DAC amortization `DeferredPolicyAcquisitionCostAmortizationExpense`: 17-19y nearly everywhere; UFCS via Sch III mirror 16y; ATHS/MET via `...AndPresentValueOfFutureProfitsAmortization1` (9y/16y).
- Management-tagged ratios (pure decimals; gate-only, never the shipped number): `LossRatio` ACGL 15y/RNR 15y; `CombinedRatio` RNR 15y, MKL 2011-21, NODK 11y; `UnderwritingExpenseRatio` RNR 15y, NODK 11y; `UnderwritingIncomeLoss` too sparse everywhere (CB 4y, AIG 3y, RNR 10-Qs, NODK 7y) — cost of float must be computed, never read.

### 1.13 Cost of deposit-type float
`InterestCreditedToPolicyholdersAccountBalances`: PFH 19y, MET 19y, LNC 19y, VOYA 12y, AIG 2009-23, ALL 2007-21 (ends with life sale), CB 5y (2021-25 — needed the moment CB's deposit book enters its float sum), ATHS only 2022+ (pre-2022 buried in custom `ahl:InterestSensitiveContractBenefitsExpense` — cost of float API-dark for its first eight public years), GL/AIZ never. Confidence HIGH at MEGA-LIFE ex-ATHS and LNC; MEDIUM/WITHHOLD elsewhere.

### 1.14 Investment income (existing line, two verified defects)
- ACGL: investmentIncome NULL in all ten shipped years because the pipeline maps only `NetInvestmentIncome`; ACGL has tagged `InvestmentIncomeNet` for 18 years. Trivial fallback fix.
- ATHS: `NetInvestmentIncome` dark FY2024-25 — facts still filed but carry srt:ConsolidatedEntitiesAxis, which companyfacts drops. Only API-visible NII is Sch III mirror (12y). The Sch III mirror `SupplementaryInsuranceInformationNetInvestmentIncome` exists as a cross-check series at PGR/ALL/AIZ/UFCS-class filers too.
- AIG cliff 2023→2024 ($14.6B → $4.25B) is Corebridge deconsolidation, not collapse — continuity tripwires must expect deconsolidations.

### 1.15 Catastrophe losses
ZERO standard us-gaap tags at all 18 filers, all years — unanimous across all six subtype surveys. Custom tags only, at exactly two filers: `trv:PolicyholderBenefitsAndClaimsIncurredNetCatastropheLosses` and `pgr:PolicyholderBenefitsAndClaimsIncurredCatastropheLoss` (+ ex-cat companion, and `pgr:PercentOfPriorYearClaimsAndClaimsAdjustmentExpense` as a ready-made gate ratio). Doctrine answer: per-company map or withhold; never estimate, never normalize; publish as-reported ratios with an explicit cat-unadjusted caveat.

### 1.16 Long-tail exhibits (mostly dead or dimensioned)
- A&E: CB 17y net+gross with incurred/paid flows, TRV 16y net, MKL 2008-18 then stopped, AIG untagged despite historical materiality. Worst-year panel buildable for CB/TRV only.
- IBNR: HRTG 9y, AIZ 12y, RNR 11y; dead/dimensioned elsewhere (post-ASU 2015-09 the split moved into dimensional tables).
- Reserve discount: ACGL 10y (`ShortdurationInsuranceContractsDiscountedLiabilitiesAggregateDiscount`); TRV ends 2017, AIG 2012, others never — a Munger blind spot (discounting flatters adequacy invisibly).
- Accident-year triangles: fully tagged at TRV/PGR/MET but ALWAYS accident-year-dimensioned, invisible to companyfacts; member-name drift across three spellings; PGR splits contexts across a wrapper + exhibit document set (single-file parsers silently lose everything); prior columns are unaudited RSI. NOT first-wave work.

### 1.17 Custom-namespace finding (unusually clean)
15 of 18 filers expose ZERO custom-namespace facts in default context; every insurance-economics figure is standard us-gaap. The exceptions that matter: ATHS (`ahl:` tags carry first-order economics — benefits expense, combined DAC/DSI/VOBA), TRV/PGR/MET (custom tags carry the OWNER-HEADLINE versions of development and cat figures). Operational rule: extraction needs tag-succession seam gates within us-gaap, not custom-namespace fallbacks — except ATHS, which needs filing-level parsing or withholds.

---

## 2. PROPOSED NEW LINES (minimal set, ranked by owner-value)

Fixes to EXISTING lines first (correctness campaign, wrong numbers shipping today):
- F1. investmentIncome: add `InvestmentIncomeNet` to the fallback chain (unblanks ACGL, 18y). Gate: overlap equality where both tags exist; Sch III mirror cross-check.
- F2. claimsIncurred: add rollforward stitch `LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaims1` (unblanks MKL FY2024-25; overlap verified equal). Gate: overlap equality; withhold ALL FY2024+ (consolidated line went dimension-only — never substitute BenefitsLossesAndExpenses).
- F3. underwritingExpense: gate the component build to require a tagged other-expense line; where absent (CB/AIG/TRV/ACGL/RNR/HRTG), mark the line partial or withhold the expense ratio rather than shipping DAC-amortization-as-whole.
- F4. lossReserves: keep as gross, but stop treating it as float (see Section 3); add subtype-aware n/a handling (ATHS no claims liability; PFH combined tag; LNC dead 2022).

New lines (name / tag sources / applicability / gate):
1. reserveDevelopmentPriorYear — primary + SecSchedule variant + predecessor lineage. All P&C subtypes + MET(labeled sub-book). Gates: CY+PY=total identity, rollforward-scope reconciliation, deprecation-seam overlap, sign-from-fact, corroborating-pair tie-out at CB. Withhold: LNC, PFH, ATHS, GL post-2018, VOYA, AIG 2013-17 hole, TRV until Tier-2 parsing — and the wall says why.
2. unearnedPremiums — `UnearnedPremiums`; Sch III fallback for life. All P&C; life immaterial/optional. Gate: non-negative; scale vs premiumsEarned; continuity.
3. lossReservesNet — `LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseNet`. All P&C + MET. Gate: net <= gross; gross = net + recoverable where all three extract.
4. premiumsWrittenNet — face tag with Sch III fallback, overlap-equality seam gate mandatory before splicing (AIG 2011-16, UFCS verified). P&C subtypes only. Gates: written ≈ earned ± ΔUPR (the AIZ partial-scope series fails this loudly — that is the point); direct+assumed−ceded=net where splits exist. Withhold: AIZ, NODK post-2021, all life (structurally n/a — display "not applicable," not blank).
5. futurePolicyBenefits — pure tag + combined-tag splice (gate FPB <= combined; post-LDTI equality check). Life subtypes + CB/AIG.
6. policyholderDeposits — per-filer element map (ContractDeposits / PolicyholderFunds / OtherPolicyholderFunds) with succession seams. Life + CB/AIG. Withhold CB 2012-2020 gap. Gate: cross-tag identity in dual-tagged years (VOYA verified same value).
7. separateAccountsLiability (+ assets internally) — exclusion line, never summed into float. Gate: assets ≈ liability. Record genuine-absence as n/a (ATHS, TRV, PGR).
8. premiumsReceivable — `PremiumsReceivableAtCarryingValue` only; polluted combined tags rejected. Gate: non-negative (VOYA −$0.03B exhibit), non-stale. Withhold: AIG, MKL(or label approximate — open question), NODK most years, GL/PFH/ATHS.
9. dacBalance — face tag; combined DAC+VOBA variants accepted with impurity flag (ALL/UFCS/LNC/VOYA/MET). Withhold ATHS post-2022 with LHX-class warn. Companion watch: NODK's 5 straight years of DAC impairment (Munger flag).
10. prepaidReinsurance — where tagged; absence handled inside float gate (see Section 3).
11. reinsuranceRecoverables — three-generation stitch with per-splice seam gates + `ReinsuranceRecoverablesAllowance`. All subtypes. Gate: gross-net-recoverable identity; recoverables/equity flag > 1x; growth-vs-gross-reserves flag; distinguish n/a (GL) via ceded-premiums presence. Withhold ALL post-2020.
12. cededPremiums (written where available, earned fallback) — dependence ratio input. Gate: bridge identity.
13. interestCredited — `InterestCreditedToPolicyholdersAccountBalances`. Life subtypes + CB/AIG/ALL(historical). Required before any deposit balance enters a float sum. Withhold ATHS pre-2022.
14. fpbRemeasurement (LDTI honesty meter) — LNC/MET/ATHS, 2021+ only, labeled as the development line's long-duration heir.
15. reserveRollforward gate-inputs (incurred CY/PY, paid CY/PY) — extracted for gating and paid-to-incurred cash check, optionally surfaced.

---

## 3. FLOAT ARITHMETIC (Buffett's definition as the standard)

P&C subtypes (MEGA-PC, PERS, SPEC-RE, SMALL-PC):
float = lossReservesNet + (unearnedPremiums − prepaidReinsurance) + futurePolicyBenefits(if any) + policyholderDeposits(if any) − premiumsReceivable − dacBalance
- Net reserves, not gross: gross-basis float is wrong-side for cedents (HRTG ~3x, ACGL materially). Where only gross + recoverable extract, derive net through the verified identity.
- Computable ~18y: CB, TRV, PGR, ALL(pre-2020 net basis), AIZ, ACGL, MKL(receivable caveat), RNR(NCI caveat), UFCS, HRTG.
- WITHHOLD: AIG (deduction side fails cleanly — no clean receivable, no prepaid reinsurance; per doctrine withhold, never approximate); NODK (prepaid reinsurance untagged most years); ALL post-2020 on a net basis (net-reserve tag and recoverables both dark — CONFLICT FLAG: the PERS survey's observation claims full arithmetic "computable for all three across the full record," but its own tag rows contradict that for ALL's recent years; treat as gross-basis-only pending owner decision); RNR published only with a gross-of-third-party-capital flag (DaVinci/Medici/Vermeer/Fontana consolidated; NCI equity 16y is the only adjustment lever).
- UFCS pre-2018 series carries a composition-splice warning (life segment sold 2018).

Life subtypes (MEGA-LIFE, MID-LIFE):
float = futurePolicyBenefits (combined-tag spliced) + policyholderDeposits + marketRiskBenefitLiability − reinsuranceRecoverables − dacBalance − premiumsReceivable(where clean)
- Separate accounts excluded entirely. Closed-block liabilities (PFH/MET demutualization) are ring-fenced — do not score as owner float earnings.
- Cost of float is NOT a combined ratio: refuse combined ratio outright for life (as floatYield is withheld today). Compute cost = interestCredited + fpbRemeasurement, judged against investmentIncome; publish spread-over-crediting where both sides extract cleanly (PFH/MET/LNC/VOYA candidates).
- WITHHOLD: ATHS cost side pre-2022 and DAC post-2022 (custom tags), ATHS NII post-2023 (dimensioned) — general-account balance stack is buildable but the record must warn; PFH/ATHS receivable deduction missing — either disclose the conservative overstatement or withhold (open question); everything at any filer across the LDTI 2021/22 seam without a hard seam warn.
- Missing-data honesty: PFH's development meter and LNC's development history are not in XBRL at all — display "withheld: not disclosed in structured data." The absence is itself information the reader can price.

---

## 4. SURFACES

- Cost-of-float dial (WS2 terminal, insurer pages): float level + yield on float (investmentIncome − interestCredited, over average float), underwriting result judged separately. P&C: computed cost via honest totals; combined ratio only where fully component-buildable (PGR) or cross-checked against management-tagged ratios (RNR/NODK), else withheld with the reason shown.
- Development honesty line: 10-year signed strip of reserveDevelopmentPriorYear per insurer — favorable-year counts, streaks (MET's 2018-25 unbroken unfavorable run; UFCS's decade of releases then +67.8M; NODK's escalating adverse run at ~22% of opening reserves), and explicit withheld-states (LNC never disclosed; AIG's 2013-17 hole). Munger pairing on the same surface: current-year loss ratio next to the release, so a release dressing an underpriced year is visible.
- Peer metrics (src/lib/peers.mjs): lift floatYield withhold for life only where both spread sides extract; add recoverables/equity, ceded-dependence, written/earned discipline ratio, DAC/reserves. Subtype-aware n/a rendering.
- Almanac criteria: through-the-cycle combined/loss ratio, worst-year (Graham), consecutive-favorable-development, reinsurance-dependence ceiling, float-growth vs premiums discipline.
- Correctness-campaign tripwires (infrastructure surface): the new gates (identity, seam-overlap, scope, sign, deconsolidation/LHX-class dark-series warns, restatement-seam detection) join the existing continuity/identity audits.

---

## 5. RISKS & WITHHOLDS

1. companyfacts drops ALL dimensioned facts — structural, verified not hypothesized (TRV development, ATHS NII, VOYA MRB, all triangles, all segment data). Anything first-wave must be undimensioned; Tier-2 requires inline-XBRL/R-file parsing with a small auditable dimension-acceptance rule.
2. Tag-succession seams are pervasive (recoverables 3 generations, CB deposits, AIG written, PGR earned, development lineage, PFH/LNC/VOYA FPB). Every splice needs an overlap-equality gate; every tested overlap so far passed exactly — but a single-tag extractor would ship confident nonsense (UFCS recoverables, AIZ written).
3. Structural breaks masquerade as trends: AIG/Corebridge 2024, ALL/AIZ 2021 divestitures, UFCS 2018, NODK's re-presentation (same date, two honest values 82% apart). A previously-populated series ending while 10-Ks continue = deconsolidation flag or extraction failure — withhold-and-warn, never zero, never a truncated record.
4. LDTI 2021/22 severs life comparability in nearly every series, including ALREADY-SHIPPED equity (AOCI whipsaw) — hard seam warn; consider ex-AOCI book-value companion.
5. Catastrophe losses: unextractable from standard XBRL anywhere; custom tags at TRV/PGR only; MD&A otherwise. Withhold or per-company map; every published underwriting figure carries a cat-unadjusted caveat.
6. Partial-scope traps: AIZ written (Sch III P&C-sliver), MET development (group book), frames entities like CVS/Humana where the tag covers a sliver — the development number must always be labeled with the reserves it developed against.
7. Custom-tag exposure is concentrated: only ATHS hides first-order economics in an extension namespace; TRV/PGR custom tags are headline enrichment with flipped-sign risk. Per-company maps limited to those; everything else is standard-tag work.
8. Structurally n/a vs missing must be schema-distinct: ATHS separate accounts, GL recoverables, TRV FPB, life written premiums. A wrong mapping is worse than a missing one.
9. Out of XBRL entirely (text or withhold, all filers): statutory surplus and subsidiary dividend capacity, policy counts/lapse/surrender rates, reinsurance towers and counterparty identity/collateral, reinstatement premiums, cat detail, ACGL mortgage-segment specifics, RNR fee income, pre-2007/2009 history (the 2004-05 hurricane worst-years cannot come from XBRL).

---

## 6. OPEN QUESTIONS FOR THE OWNER

1. Phase gate: approve Wave A (companyfacts-only, ~15 filers clean) shipping before Wave B (inline-XBRL dimension-rule parsing) exists — accepting that TRV, a marquee P&C name, shows a WITHHELD development line in the interim?
2. ALL post-2020 float: publish on a gross-reserve basis with an explicit basis label, or withhold entirely? (Net basis is unextractable; the PERS survey internally conflicts on this.)
3. Labeled-approximate vs withhold for polluted deductions (MKL's combined receivable tag): the SPEC-RE survey proposes "labeled approximate"; house doctrine says withhold. Which binds?
4. Life subtype metric approval: adopt spread-over-crediting as the published cost-of-float, and formally refuse the combined ratio for life insurers on the page (a doctrine-level presentation decision)?
5. Catastrophe losses: blanket withhold with caveat, or accept per-company custom-tag maps for TRV/PGR now (two-filer coverage) with text extraction later?
6. RNR third-party capital: flag-only (float labeled gross of NCI) or attempt an NCI-adjusted owner's-share float using the 16y NCI equity tag?
7. Redefinition risk: switching float's base from the shipped gross lossReserves to net changes numbers already public — does this ship as a correction note under the correctness campaign, or as a new line alongside the old?
8. MET's development line covers only its short-duration book: publish with a denominator label, or withhold as unrepresentative of the enterprise?
9. Book value ex-AOCI companion for life insurers (LDTI whipsaw): add to the schema now or defer?
10. New-shelf gate compliance: these lines imply insurer-subtype grouping columns — confirm shelves.json + groupingColumns work is in scope per the terminal mandate before extraction lands.

Evidence files referenced by the surveys: scratchpad cf_*.json, inv_*.json, inventory.tsv, megalife/{PFH,MET,ATHS}_inventory.json under C:/Users/ryanr/AppData/Local/Temp/claude/c--Users-ryanr/6d6f1b58-2746-4214-95da-20156eb83cfd/scratchpad; pipeline tag lists at C:/Users/ryanr/.surplus-scout/ownerscorecard-terminal/scripts/fetchFundamentals.mjs lines 273-280; withhold logic at C:/Users/ryanr/.surplus-scout/ownerscorecard-terminal/src/lib/peers.mjs (floatYield).