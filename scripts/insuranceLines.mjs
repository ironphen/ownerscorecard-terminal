// insuranceLines.mjs — Wave A of the insurance desk (docs/insurance-desk-survey.md, ratified
// 2026-07-21): the float components, the discipline lines, and the honesty meter, extracted from
// SEC companyfacts under the gates the desk designed. Perfected once; the pipeline benefits forever.
//
// Doctrine encoded here, from the ratified spec:
//   - Undimensioned us-gaap facts only (companyfacts drops dimensioned facts; Tier-2 inline-XBRL
//     parsing is later work). A concept a filer reports only dimensioned reads as absent — TRV's
//     development line is WITHHELD, with the reason, not approximated.
//   - Tag-succession seams are stitched ONLY through an overlap-equality gate: where two tag
//     generations share years, they must agree within tolerance or the OLDER generation is dropped
//     whole and a warning recorded. Every splice the desk tested passed exactly; a splice that
//     doesn't is a definitional change, not a continuation.
//   - Signed facts keep their filed sign (development: negative = favorable, uniform across the
//     surveyed pool; TRV's custom tag has it flipped, which is why custom tags are never read).
//   - A value that fails its plausibility gate is nulled and warned, never "fixed": wrong is worse
//     than missing. Structurally-absent concepts (a pure P&C carrier has no separate accounts) are
//     simply absent — absence of a tag is not an error.
//
// Self-contained readers (same filters as fetchFundamentals: 10-K forms, ~annual durations,
// latest-filed-wins) so this module has no import cycle with the fetcher that calls it.

const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

// Per-tag annual flows (10-K, 350-380d duration, latest filing wins the year).
function flowByYear(facts, tag) {
  const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.USD;
  if (!units) return null;
  const out = {};
  for (const u of units) {
    if (!u.form || !u.form.startsWith("10-K") || !u.start || !u.end) continue;
    const dur = days(u.start, u.end);
    if (dur < 350 || dur > 380) continue;
    const fy = new Date(u.end).getUTCFullYear();
    if (!out[fy] || (u.filed || "") > (out[fy].filed || "")) out[fy] = { val: u.val, filed: u.filed || "" };
  }
  return Object.keys(out).length ? Object.fromEntries(Object.entries(out).map(([fy, e]) => [fy, e.val])) : null;
}

// Per-tag instants (balance items: no start date). Within a fiscal-year bin the LATEST END DATE
// wins first, and filed date breaks ties only among facts at that same date — because LDTI
// restatement filings tag OPENING-balance instants (Jan-1 transition dates, Q1 balances in a
// 10-K/A) whose later filed dates would otherwise beat the true year-end balance (the hostile
// verify caught MetLife's FY2021 FPB reading the 2021-01-01 transition balance, $224.4B, over
// the real 2021-12-31 balance, $199.7B — and Lincoln's 10-K/A doing the same twice). The
// fiscal-year balance is the year's last instant; a restated year-end still wins via filed date.
function instantTagByYear(facts, tag, fyEnds = null) {
  const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.USD;
  if (!units) return null;
  const out = {};
  for (const u of units) {
    if (!u.form || !u.form.startsWith("10-K") || !u.end || u.start) continue;
    const fy = new Date(u.end).getUTCFullYear();
    if (fyEnds?.[fy] && Math.abs(days(fyEnds[fy], u.end)) > 14) continue;
    const cur = out[fy];
    if (!cur || u.end > cur.end || (u.end === cur.end && (u.filed || "") > (cur.filed || "")))
      out[fy] = { val: u.val, end: u.end, filed: u.filed || "" };
  }
  return Object.keys(out).length ? Object.fromEntries(Object.entries(out).map(([fy, e]) => [fy, e.val])) : null;
}

// The seam gate: merge tag generations newest-first. Where adjacent generations overlap, shared
// years must agree within tolerance (relative, with an absolute floor so small signed values
// like a $40M development don't fail on rounding). Two failure shapes, two treatments:
//   - MOST overlap years disagree: the tags measure different things (the three reinsurance-
//     recoverable definitions) — the OLDER generation is dropped whole; splicing definitions is
//     the confident-nonsense class the gate exists to prevent.
//   - A MINORITY of overlap years disagree: those are re-tagged comparatives — a newer filing
//     restating an old year under the new tag (the CECL day-one backfill: BAC's 2019 allowance
//     re-tagged at 12.358B over the year's own 9.416B). The tag that was CURRENT at a year is
//     authoritative for that year, so the older generation's value stands there, with a warning.
export function stitchGenerations(gens, { tol = 0.01, absFloor = 2e6, label = "" } = {}) {
  const warns = [];
  let merged = null;
  for (const g of gens) {
    if (!g) continue;
    if (!merged) { merged = { ...g }; continue; }
    const overlap = Object.keys(g).filter((fy) => merged[fy] != null);
    const disagreeing = overlap.filter((fy) => {
      const a = merged[fy], b = g[fy];
      return Math.abs(a - b) > Math.max(Math.abs(a) * tol, absFloor);
    });
    if (overlap.length && disagreeing.length / overlap.length > 0.5) {
      warns.push(`${label}: predecessor tag disagrees in overlap — older generation dropped`);
      continue;
    }
    // An isolated cross-era disagreement is a contested year (a re-tagged comparative, a scope
    // shift, an adoption backfill — BAC's 2019 allowance carries THREE values across tags).
    // Withhold the year rather than crown any scope: never average, never adjudicate blind.
    for (const fy of disagreeing) {
      merged[fy] = null;
      warns.push(`${label} ${fy}: cross-era values conflict — year withheld`);
    }
    for (const fy of Object.keys(g)) if (merged[fy] == null && !disagreeing.includes(fy)) merged[fy] = g[fy];
  }
  return { series: merged, warns };
}

// Does this filer carry the insurance economics at all? Premiums earned (either tag family) is the
// entry ticket; without it none of the lines below are attempted and the company is untouched.
export function hasInsuranceData(facts) {
  return !!(flowByYear(facts, "PremiumsEarnedNet") || flowByYear(facts, "PremiumsEarnedNetPropertyAndCasualty"));
}

// The Wave A extraction. Returns { flows, instants, flags } where flows/instants map
// line -> { fy -> value } (absent lines omitted entirely), and flags carries warnings plus the
// DAC impurity marker. All gates from the ratified spec are applied here, at the source.
export function insuranceLines(facts, fyEnds = null) {
  const warns = [];
  const flags = {};
  const flows = {};
  const instants = {};
  const W = (s) => warns.push(s);

  // --- the honesty meter: prior-year reserve development (signed as filed) ---
  // Scope ruling (desk, 2026-07-21, from the hostile verify): the intended concept is the
  // TOTAL-COMPANY development — the honesty meter on the whole enterprise's past promises. Some
  // filers (Chubb from FY2023) also file the narrower S-X Schedule VI element
  // (SecSchedule1218SupplementalInformationPropertyCasualtyInsuranceUnderwriters...) with a
  // different, P&C-rescoped value in the same 10-K; that element is deliberately NOT read here —
  // mixing the two scopes in one series would be exactly the confident-nonsense splice the seam
  // gate exists to prevent. If a filer's legacy element dies, its series honestly ends.
  {
    const { series, warns: w } = stitchGenerations([
      flowByYear(facts, "SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense"),
      flowByYear(facts, "LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaimsPriorYears"),
    ], { tol: 0.02, label: "reserveDevelopmentPriorYear" });
    w.forEach(W);
    if (series) flows.reserveDevelopmentPriorYear = series;
  }

  // --- float components (balance) ---
  {
    const { series, warns: w } = stitchGenerations([
      instantTagByYear(facts, "UnearnedPremiums", fyEnds),
      instantTagByYear(facts, "SupplementaryInsuranceInformationUnearnedPremiums", fyEnds),
    ], { label: "unearnedPremiums" });
    w.forEach(W);
    if (series) {
      for (const fy of Object.keys(series)) if (series[fy] < 0) { series[fy] = null; W(`unearnedPremiums ${fy}: negative — nulled`); }
      instants.unearnedPremiums = series;
    }
  }
  {
    const net = instantTagByYear(facts, "LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseNet", fyEnds);
    if (net) {
      // Net may not exceed gross where the gross line exists (2% tolerance for rounding).
      const gross = instantTagByYear(facts, "LiabilityForClaimsAndClaimsAdjustmentExpense", fyEnds);
      for (const fy of Object.keys(net)) {
        if (gross?.[fy] != null && net[fy] > gross[fy] * 1.02) { net[fy] = null; W(`lossReservesNet ${fy}: exceeds gross — nulled`); }
      }
      instants.lossReservesNet = net;
    }
  }
  {
    const fpb = instantTagByYear(facts, "LiabilityForFuturePolicyBenefits", fyEnds);
    const combined = instantTagByYear(facts, "LiabilityForFuturePolicyBenefitsAndUnpaidClaimsAndClaimsAdjustmentExpense", fyEnds);
    if (fpb && combined) {
      for (const fy of Object.keys(fpb)) {
        if (combined[fy] != null && fpb[fy] > combined[fy] * 1.02) { fpb[fy] = null; W(`futurePolicyBenefits ${fy}: exceeds combined liability — nulled`); }
      }
    }
    if (fpb) instants.futurePolicyBenefits = fpb;
    if (combined) instants.fpbCombined = combined;
  }
  {
    // Policyholder deposits: three us-gaap elements name one concept; the filer's element is the
    // one with the longest series (the per-filer element map, data-driven). Another element may
    // fill years the primary lacks ONLY when any overlapping years agree; the survey's CB case
    // (two disjoint eras, a 2012-2020 gap where neither is tagged) keeps its gap honestly null.
    const els = [
      instantTagByYear(facts, "PolicyholderContractDeposits", fyEnds),
      instantTagByYear(facts, "PolicyholderFunds", fyEnds),
      instantTagByYear(facts, "OtherPolicyholderFunds", fyEnds),
    ].filter(Boolean).sort((a, b) => Object.keys(b).length - Object.keys(a).length);
    if (els.length) {
      const { series, warns: w } = stitchGenerations(els, { label: "policyholderDeposits" });
      w.forEach(W);
      if (series) instants.policyholderDeposits = series;
    }
  }
  {
    const liab = instantTagByYear(facts, "SeparateAccountsLiability", fyEnds);
    const assets = instantTagByYear(facts, "SeparateAccountAssets", fyEnds);
    if (liab) {
      for (const fy of Object.keys(liab)) {
        if (assets?.[fy] != null && Math.abs(assets[fy] - liab[fy]) > Math.abs(liab[fy]) * 0.02)
          W(`separateAccounts ${fy}: assets and liability diverge beyond 2% — pass-through identity broken`);
      }
      instants.separateAccountsLiability = liab;
    } else if (assets) {
      instants.separateAccountsLiability = assets; // a few filers tag only the asset side of the pass-through
    }
  }

  // --- float deductions ---
  {
    const pr = instantTagByYear(facts, "PremiumsReceivableAtCarryingValue", fyEnds);
    if (pr) {
      for (const fy of Object.keys(pr)) if (pr[fy] < 0) { pr[fy] = null; W(`premiumsReceivable ${fy}: negative — nulled`); }
      instants.premiumsReceivable = pr;
    }
  }
  {
    const pure = instantTagByYear(facts, "DeferredPolicyAcquisitionCosts", fyEnds);
    const withVoba = instantTagByYear(facts, "DeferredPolicyAcquisitionCostsAndValueOfBusinessAcquired", fyEnds);
    // The combined DAC+VOBA tag is a different (impure) definition, not a predecessor: it stands in
    // only when the pure tag is absent altogether, and the impurity is flagged for the display layer.
    if (pure) instants.dacBalance = pure;
    else if (withVoba) { instants.dacBalance = withVoba; flags.dacIncludesVoba = true; }
  }
  {
    const ppd = instantTagByYear(facts, "PrepaidReinsurancePremiums", fyEnds);
    if (ppd) instants.prepaidReinsurance = ppd;
  }

  // --- reinsurance (counterparty risk on the float) ---
  {
    const { series, warns: w } = stitchGenerations([
      instantTagByYear(facts, "ReinsuranceRecoverablesOnPaidAndUnpaidLosses", fyEnds),
      instantTagByYear(facts, "ReinsuranceRecoverableForUnpaidClaimsAndClaimsAdjustments", fyEnds),
      instantTagByYear(facts, "ReinsuranceRecoverables", fyEnds),
    ], { tol: 0.02, label: "reinsuranceRecoverables" });
    w.forEach(W);
    if (series) instants.reinsuranceRecoverables = series;
    const allow = instantTagByYear(facts, "ReinsuranceRecoverablesAllowance", fyEnds);
    if (allow) instants.reinsuranceRecoverablesAllowance = allow;
  }

  // --- the discipline lines: premiums written, and the direct/assumed/ceded bridge ---
  {
    const { series, warns: w } = stitchGenerations([
      flowByYear(facts, "PremiumsWrittenNet"),
      flowByYear(facts, "SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPremiumsWritten"),
    ], { label: "premiumsWrittenNet" });
    w.forEach(W);
    if (series) {
      // Scope gate: written and earned describe the same book, so their ratio holds near one.
      // A Schedule-III series covering only a sliver of the enterprise (the AIZ case: 3.6B written
      // against 10.5B earned) fails loudly here and the whole line is withheld.
      const earned = flowByYear(facts, "PremiumsEarnedNet") || flowByYear(facts, "PremiumsEarnedNetPropertyAndCasualty");
      const bad = Object.keys(series).filter((fy) => {
        const e = earned?.[fy];
        return e != null && e > 0 && (series[fy] / e < 0.6 || series[fy] / e > 1.67);
      });
      if (bad.length >= 3) {
        W(`premiumsWrittenNet: written/earned ratio out of band in ${bad.length} years — partial-scope series, line withheld`);
      } else {
        flows.premiumsWrittenNet = series;
        // Bridge identity, advisory: direct + assumed − ceded = net, where the parts exist.
        const d = flowByYear(facts, "DirectPremiumsWritten");
        const a = flowByYear(facts, "AssumedPremiumsWritten");
        const c = flowByYear(facts, "CededPremiumsWritten");
        for (const fy of Object.keys(series)) {
          if (d?.[fy] != null && c?.[fy] != null) {
            const bridge = d[fy] + (a?.[fy] || 0) - c[fy];
            if (Math.abs(bridge - series[fy]) > Math.abs(series[fy]) * 0.02)
              W(`premiumsWrittenNet ${fy}: direct+assumed−ceded misses net by >2%`);
          }
        }
      }
    }
    const cw = flowByYear(facts, "CededPremiumsWritten");
    if (cw) flows.cededPremiumsWritten = cw;
    const { series: ce } = stitchGenerations([
      flowByYear(facts, "CededPremiumsEarned"),
      flowByYear(facts, "CededPremiumsEarnedPropertyAndCasualty"),
    ], { label: "cededPremiumsEarned" });
    if (ce) flows.cededPremiumsEarned = ce;
  }

  // --- the cost side of deposit float, and the LDTI honesty analog ---
  {
    const ic = flowByYear(facts, "InterestCreditedToPolicyholdersAccountBalances");
    if (ic) flows.interestCredited = ic;
    const rm = flowByYear(facts, "LiabilityForFuturePolicyBenefitRemeasurementGainLoss");
    if (rm) flows.fpbRemeasurement = rm;
    // Market risk benefits (LDTI, 2021+): the variable-annuity guarantee liability, part of life
    // float under the spec's arithmetic. Short series by construction; VOYA's is dimensioned-only
    // and therefore honestly absent.
    const mrb = instantTagByYear(facts, "MarketRiskBenefitLiabilityAmount", fyEnds);
    if (mrb) instants.marketRiskBenefits = mrb;
  }

  // --- the expense-ratio honesty flag (spec F3): the component build is whole only where the
  // filer tags the other-underwriting-expense line; elsewhere the pipeline's underwritingExpense
  // silently degrades to DAC amortization alone, and the display layer must know.
  {
    const oue = flowByYear(facts, "OtherUnderwritingExpense");
    if (oue) flows.otherUnderwritingExpense = oue;
  }

  if (warns.length) flags.warns = [...new Set(warns)];
  return { flows, instants, flags };
}

// Spec F2: fill missing claimsIncurred years from the reserve-rollforward incurred line, only
// where the two series agree in at least one overlapping year (the Markel case: overlap verified
// equal to the dollar; the fill extends a proven-identical series, never introduces a new one).
export function fillClaimsFromRollforward(claimsByYear, facts) {
  const roll = stitchGenerations([
    flowByYear(facts, "LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaims1"),
    flowByYear(facts, "LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaims"),
  ], { label: "incurredClaimsRoll" }).series;
  if (!roll) return { filled: claimsByYear, usedRollforward: false };
  // The seam-adjacent overlap year is the one that justifies extension: the LATEST year both
  // series carry must agree within 1% (older years may drift on in-filing presentation
  // differences — Markel's 2016-2021 vary by up to 0.6% while the 2022-23 seam is exact).
  const overlap = Object.keys(roll).filter((fy) => claimsByYear[fy] != null).map(Number);
  if (!overlap.length) return { filled: claimsByYear, usedRollforward: false };
  const seamFy = Math.max(...overlap);
  const agrees = Math.abs(roll[seamFy] - claimsByYear[seamFy]) <= Math.abs(claimsByYear[seamFy]) * 0.01;
  if (!agrees) return { filled: claimsByYear, usedRollforward: false };
  const filled = { ...claimsByYear };
  let used = false;
  for (const fy of Object.keys(roll)) if (filled[fy] == null) { filled[fy] = roll[fy]; used = true; }
  return { filled, usedRollforward: used };
}
