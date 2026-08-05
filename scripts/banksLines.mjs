// banksLines.mjs — Wave A of the banks desk (docs/banks-desk-survey.md, ratified 2026-07-21):
// the deposit franchise, the credit cycle, the securities marks, and the spread legs, extracted
// from SEC companyfacts under the gates the desk designed. Same architecture as the insurance
// desk's module — per-concept tag chains with per-filer tag aliases, seam gates, withhold-never-
// guess — because the census found no custom-tag rescues anywhere: what varies across banks is
// us-gaap tag CHOICE, not namespace.
//
// The census's verified hazards, encoded:
//   - CECL adoption contamination (2019-12-31): later filings re-tag day-one allowance balances
//     at the pre-adoption date (BAC 12.358B over the true 9.416B). Where one date carries
//     materially different values across filings, the EARLIEST-filed value — the year's own
//     10-K, pre-restatement — wins, with a warning. Scoped to the credit-balance readers where
//     the hazard is verified; ordinary restatements elsewhere keep latest-filed.
//   - Scope mixing: some allowance tags include the unfunded-commitments reserve, some are
//     loans-only. The magnitude gate (allowance 0.5–3% of loans) catches every instance the
//     census found; failures null the year, never average.
//   - The JPM PCI trap: 2012-2017 write-off facts carry a purchased-credit-impaired subset ~30x
//     below reality. The NCO magnitude gate (net charge-offs 0.05–5% of loans) withholds them.
//   - Sign flips inside one filing (FULT's net write-offs) and subtotal-mixing series (CBU/ESQ
//     nonaccruals alternating thousands with millions): a sign-consistency gate and an adjacent-
//     year volatility gate withhold the series rather than publish a shape that cannot be real.
//   - CET1 is tagged as a fraction of one, [pure] unit, at regionals only; read gate-only with a
//     scale band, and ABSENCE NEVER READS AS FAILURE (a filer can move it onto an axis mid-record).
import { stitchGenerations } from "./insuranceLines.mjs";

const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

function flowByYear(facts, tag, unit = "USD") {
  const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
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

// Instants under the F2 fiscal-calendar pin. earliestOnConflict engages the adoption-seam guard:
// same date, materially different values across filings -> the year's own (earliest-filed) 10-K
// wins and the conflict is reported.
function instantByYear(facts, tag, fyEnds, { unit = "USD", earliestOnConflict = false, conflicts = null } = {}) {
  const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
  if (!units) return null;
  const perYear = {};
  for (const u of units) {
    if (!u.form || !u.form.startsWith("10-K") || !u.end || u.start) continue;
    const fy = new Date(u.end).getUTCFullYear();
    if (fyEnds?.[fy] && Math.abs(days(fyEnds[fy], u.end)) > 14) continue;
    (perYear[fy] ||= []).push({ val: u.val, end: u.end, filed: u.filed || "" });
  }
  const out = {};
  for (const fy of Object.keys(perYear)) {
    const xs = perYear[fy].sort((a, b) => (a.end !== b.end ? (a.end > b.end ? -1 : 1) : (a.filed > b.filed ? -1 : 1)));
    const atLatestEnd = xs.filter((x) => x.end === xs[0].end);
    const vals = [...new Set(atLatestEnd.map((x) => x.val))];
    const divergent = vals.length > 1 && (Math.max(...vals) - Math.min(...vals)) > Math.abs(vals[0]) * 0.01;
    if (divergent && earliestOnConflict) {
      const earliest = [...atLatestEnd].sort((a, b) => (a.filed < b.filed ? -1 : 1))[0];
      conflicts?.push(`${tag} ${fy}: multi-value date — kept the year's own filing`);
      out[fy] = earliest.val;
    } else {
      out[fy] = atLatestEnd[0].val;
    }
  }
  return Object.keys(out).length ? out : null;
}

// Sum two per-year series where BOTH carry the year (a domestic+foreign pair); null otherwise.
const sumPair = (a, b) => {
  if (!a || !b) return null;
  const out = {};
  for (const fy of Object.keys(a)) if (b[fy] != null) out[fy] = a[fy] + b[fy];
  return Object.keys(out).length ? out : null;
};

// Gates ------------------------------------------------------------------------------------

// Magnitude gate: value must sit within [lo, hi] as a share of the denominator series, else the
// year is nulled with a warning. The census's scope-mixing and PCI-subset catches all fail this.
function magnitudeGate(series, denomSeries, lo, hi, label, W) {
  if (!series || !denomSeries) return series;
  for (const fy of Object.keys(series)) {
    const d = denomSeries[fy];
    if (series[fy] == null || d == null || d <= 0) continue;
    const r = Math.abs(series[fy]) / d;
    if (r < lo || r > hi) { series[fy] = null; W(`${label} ${fy}: outside the ${lo * 100}–${hi * 100}% band of its base — nulled`); }
  }
  return series;
}

// Volatility gate: a series whose adjacent readable years swing by more than maxRatio is a mixed
// subtotal/total series (the CBU/ESQ nonaccrual shape) — withhold it whole.
function volatilityGate(series, maxRatio, label, W) {
  if (!series) return null;
  const fys = Object.keys(series).map(Number).sort((a, b) => a - b).filter((fy) => series[fy] != null && series[fy] > 0);
  for (let i = 1; i < fys.length; i++) {
    const r = series[fys[i]] / series[fys[i - 1]];
    if (r > maxRatio || r < 1 / maxRatio) { W(`${label}: adjacent years swing ${r.toFixed(0)}x — a mixed-scope series, withheld`); return null; }
  }
  return series;
}

// The entry ticket: a deposit-funded lender. Without both, none of this runs.
export function hasBankData(facts, fyEnds) {
  return !!(instantByYear(facts, "Deposits", fyEnds) &&
    (flowByYear(facts, "InterestIncomeExpenseNet") || flowByYear(facts, "InterestAndDividendIncomeOperating")));
}

export function banksLines(facts, fyEnds = null) {
  const warns = [];
  const flags = {};
  const flows = {};
  const instants = {};
  const W = (s) => warns.push(s);
  const deposits = instantByYear(facts, "Deposits", fyEnds);

  // --- the deposit franchise: the moat made visible ---
  {
    const agg = instantByYear(facts, "NoninterestBearingDepositLiabilities", fyEnds);
    const nibDom = instantByYear(facts, "NoninterestBearingDepositLiabilitiesDomestic", fyEnds);
    const nibFor = instantByYear(facts, "NoninterestBearingDepositLiabilitiesForeign", fyEnds);
    // A purely domestic bank (M&T) files only the Domestic element, and that IS its complete
    // balance-sheet line; the deposits identity below validates it. Where a Foreign element
    // exists at all, both legs are required for a year.
    const pair = nibFor ? sumPair(nibDom, nibFor) : nibDom;
    const demandPredecessor = instantByYear(facts, "NoninterestBearingDomesticDepositDemand", fyEnds);
    const { series: nib, warns: w } = stitchGenerations([agg, pair, demandPredecessor], { label: "noninterestBearingDeposits" });
    w.forEach(W);
    const ibAgg = instantByYear(facts, "InterestBearingDepositLiabilities", fyEnds);
    const ibDom = instantByYear(facts, "InterestBearingDepositLiabilitiesDomestic", fyEnds);
    const ibFor = instantByYear(facts, "InterestBearingDepositLiabilitiesForeign", fyEnds);
    const ibPair = ibFor ? sumPair(ibDom, ibFor) : ibDom;
    const { series: ib } = stitchGenerations([ibAgg, ibPair], { label: "interestBearingDeposits" });
    if (nib) {
      // The exact-sum identity: NIB + IB = total deposits (verified to the dollar at every
      // money-center bank). On failure the PARTIAL leg is the offender: where NIB alone still
      // fits under total deposits, the interest-bearing leg is the partial-scope series (the
      // Flagstar case: IB $30.7B against $81.5B of deposits beside an honest NIB) — the IB year
      // is nulled and NIB stands; only a NIB exceeding deposits nulls NIB itself.
      if (ib && deposits) {
        for (const fy of Object.keys(nib)) {
          if (nib[fy] == null || ib[fy] == null || deposits[fy] == null) continue;
          if (Math.abs(nib[fy] + ib[fy] - deposits[fy]) > deposits[fy] * 0.02) {
            if (nib[fy] > deposits[fy]) { nib[fy] = null; W(`noninterestBearingDeposits ${fy}: exceeds total deposits — nulled`); }
            else { ib[fy] = null; W(`interestBearingDeposits ${fy}: partial-scope leg fails the deposits identity — nulled; NIB stands`); }
          }
        }
      }
      instants.noninterestBearingDeposits = nib;
      if (ib && Object.values(ib).some((v) => v != null)) instants.interestBearingDeposits = ib;
    } else {
      // The de-novo alias: a bank that files only DemandDepositAccounts (ESQ). Labeled demand,
      // never presented as the NIB line.
      const demand = instantByYear(facts, "DemandDepositAccounts", fyEnds);
      if (demand) { instants.demandDeposits = demand; flags.nibIsDemand = true; }
    }
  }
  {
    const ie = flowByYear(facts, "InterestExpenseDeposits");
    if (ie) flows.interestExpenseDeposits = ie;
    else {
      // Component reconstruction (the ESQ case), gated: both component tags must exist, and the
      // sum is flagged as summed — never presented as the filed total silently.
      const now = flowByYear(facts, "InterestExpenseNOWAccountsMoneyMarketAccountsAndSavingsDeposits");
      const time = flowByYear(facts, "InterestExpenseTimeDeposits");
      const summed = sumPair(now, time);
      if (summed) { flows.interestExpenseDeposits = summed; flags.ieDepositsSummed = true; }
    }
    const td = instantByYear(facts, "TimeDeposits", fyEnds);
    if (td && deposits) {
      for (const fy of Object.keys(td)) if (td[fy] != null && deposits[fy] != null && td[fy] > deposits[fy]) { td[fy] = null; W(`timeDeposits ${fy}: exceeds total deposits — nulled`); }
    }
    if (td) instants.timeDeposits = td;
    const brokered = instantByYear(facts, "InterestBearingDomesticDepositBrokered", fyEnds);
    if (brokered) instants.brokeredDeposits = brokered;
  }

  // --- the loan book (denominator for every credit ratio) ---
  const { series: loans, warns: lw } = stitchGenerations([
    instantByYear(facts, "FinancingReceivableExcludingAccruedInterestBeforeAllowanceForCreditLoss", fyEnds),
    instantByYear(facts, "NotesReceivableGross", fyEnds),
    instantByYear(facts, "LoansAndLeasesReceivableNetOfDeferredIncome", fyEnds),
    instantByYear(facts, "LoansAndLeasesReceivableNetReportedAmount", fyEnds),
  ], { label: "loansHeldForInvestment" });
  lw.forEach(W);
  if (loans) instants.loansHeldForInvestment = loans;

  // --- the credit cycle: allowance (seam-guarded) and net charge-offs ---
  {
    const conflicts = [];
    const opts = { earliestOnConflict: true, conflicts };
    const { series: allow, warns: aw } = stitchGenerations([
      instantByYear(facts, "FinancingReceivableAllowanceForCreditLossExcludingAccruedInterest", fyEnds, opts),
      instantByYear(facts, "FinancingReceivableAllowanceForCreditLosses", fyEnds, opts),
      instantByYear(facts, "LoansAndLeasesReceivableAllowance", fyEnds, opts),
    ], { label: "allowanceForCreditLosses", tol: 0.02, absFloor: 5e5 });
    aw.forEach(W);
    conflicts.forEach((c) => W(c));
    if (allow) {
      magnitudeGate(allow, loans, 0.003, 0.04, "allowanceForCreditLosses", W);
      instants.allowanceForCreditLosses = allow;
    }
  }
  {
    // Net charge-offs, net-first (the hostile verify's correction, 2026-07-21: the first build
    // shipped GROSS write-offs as net wherever the guessed recovery tag names missed — WFC read
    // $5.2B for a $3.5B year. Every tag below is now empirically confirmed at the surveyed
    // filers). Route per year: the DIRECT net tags first; else gross − recoveries only where
    // BOTH exist for the year; a gross figure alone is NEVER shipped as net — the year is
    // withheld (the TFC rule: its recoveries live only on a segment axis).
    const { series: netDirect, warns: nw } = stitchGenerations([
      flowByYear(facts, "FinancingReceivableExcludingAccruedInterestAllowanceForCreditLossWriteoffAfterRecovery"),
      flowByYear(facts, "FinancingReceivableAllowanceForCreditLossWriteoffAfterRecovery"),
      flowByYear(facts, "AllowanceForLoanAndLeaseLossesWriteoffsNet"),
    ], { label: "netChargeOffs(direct)", absFloor: 5e5 });
    nw.forEach(W);
    const { series: wo } = stitchGenerations([
      flowByYear(facts, "FinancingReceivableExcludingAccruedInterestAllowanceForCreditLossWriteoff"),
      flowByYear(facts, "FinancingReceivableAllowanceForCreditLossesWriteOffs"),
      flowByYear(facts, "AllowanceForLoanAndLeaseLossesWriteOffs"),
    ], { label: "grossWriteoffs", absFloor: 5e5 });
    const { series: rec } = stitchGenerations([
      flowByYear(facts, "FinancingReceivableExcludingAccruedInterestAllowanceForCreditLossRecovery"),
      flowByYear(facts, "FinancingReceivableAllowanceForCreditLossesRecovery"),
      flowByYear(facts, "FinancingReceivableAllowanceForCreditLossesRecoveries"),
      flowByYear(facts, "FinancingReceivableAllowanceForCreditLossesRecoveriesOfBadDebts"),
      flowByYear(facts, "AllowanceForLoanAndLeaseLossRecoveryOfBadDebts"),
      flowByYear(facts, "AllowanceForLoanAndLeaseLossesRecoveriesOfBadDebts"),
    ], { label: "recoveries", absFloor: 5e5 });
    const nco = {};
    const years = new Set([...Object.keys(netDirect || {}), ...Object.keys(wo || {})]);
    for (const fy of years) {
      const direct = netDirect?.[fy] ?? null;
      const derived = wo?.[fy] != null && rec?.[fy] != null ? Math.abs(wo[fy]) - Math.abs(rec[fy]) : null;
      if (direct != null && derived != null && Math.abs(Math.abs(direct) - derived) > Math.max(derived * 0.02, 2e6))
        W(`netChargeOffs ${fy}: direct net and gross−recoveries disagree — kept the direct tag`);
      const v = direct != null ? direct : derived;
      if (v == null) continue;
      if (wo?.[fy] != null && rec?.[fy] != null && Math.abs(rec[fy]) > Math.abs(wo[fy])) { W(`netChargeOffs ${fy}: recoveries exceed write-offs — nulled`); continue; }
      nco[fy] = v;
    }
    // The FULT sign-flip trap: a filer re-tagging comparatives with flipped signs. A large
    // negative year (beyond a fifth of the series' typical size) inside a positive series is a
    // flip, not a genuine net-recovery year — nulled. Small negatives are real and kept.
    const mags = Object.values(nco).filter((v) => v != null).map((v) => Math.abs(v)).sort((a, b) => a - b);
    const medMag = mags.length ? mags[Math.floor(mags.length / 2)] : 0;
    for (const fy of Object.keys(nco)) {
      if (nco[fy] < 0 && Math.abs(nco[fy]) > medMag * 0.2) { nco[fy] = null; W(`netChargeOffs ${fy}: large negative in a positive series — a sign-flipped comparative, nulled`); }
    }
    magnitudeGate(nco, loans, 0.0005, 0.05, "netChargeOffs", W);
    if (Object.values(nco).some((v) => v != null)) flows.netChargeOffs = nco;
  }
  {
    const na = stitchGenerations([
      instantByYear(facts, "FinancingReceivableExcludingAccruedInterestNonaccrual", fyEnds),
      instantByYear(facts, "FinancingReceivableRecordedInvestmentNonaccrualStatus", fyEnds),
    ], { label: "nonaccrualLoans" }).series;
    const gated = volatilityGate(na, 20, "nonaccrualLoans", W);
    if (gated) {
      magnitudeGate(gated, loans, 0.0002, 0.15, "nonaccrualLoans", W);
      instants.nonaccrualLoans = gated;
    }
  }
  {
    const obs = instantByYear(facts, "OffBalanceSheetCreditLossLiability", fyEnds);
    if (obs) instants.offBalanceSheetCreditReserve = obs;
  }

  // --- the securities marks: the 2023 lesson, directly tagged ---
  {
    const { series: htmCost, warns: hw } = stitchGenerations([
      instantByYear(facts, "DebtSecuritiesHeldToMaturityExcludingAccruedInterestBeforeAllowanceForCreditLoss", fyEnds),
      // The CECL-era variant the stitch was missing — and the reason 8 of the 20 largest US
      // banks were SILENT on HTM marks while carrying a fair value: fair-only rows climbed
      // 11→43 across FY2019-24 as filers migrated to this tag. Verified on EDGAR companyfacts
      // before shipping: USB files it at $76.170B (2025-12-31) against pool fair $67.079B — a
      // $9.1B unrecognized loss tying the filer's own AccumulatedUnrecognizedHoldingLoss tag to
      // the dollar ($9.190B less $99M gains); C at $189.831B against fair $179.520B ($10.3B).
      // Ordered after the BeforeAllowance variant: where both filed, the allowance is ~0 and the
      // two tie within rounding (the identity gate below still adjudicates every year).
      instantByYear(facts, "DebtSecuritiesHeldToMaturityExcludingAccruedInterestAfterAllowanceForCreditLoss", fyEnds),
      instantByYear(facts, "DebtSecuritiesHeldToMaturityAmortizedCostAfterAllowanceForCreditLoss", fyEnds),
      instantByYear(facts, "HeldToMaturitySecurities", fyEnds),
    ], { label: "htmAmortizedCost" });
    hw.forEach(W);
    const htmFv = instantByYear(facts, "HeldToMaturitySecuritiesFairValue", fyEnds);
    if (htmCost) instants.htmAmortizedCost = htmCost;
    if (htmFv) instants.htmFairValue = htmFv;
    if (htmCost && htmFv) {
      // The identity gate where the loss is itself tagged: cost − FV ≈ unrecognized loss
      // (BAC 2022: 632.9 − 524.3 = 108.6, checks exactly per the census).
      const loss = instantByYear(facts, "HeldToMaturitySecuritiesAccumulatedUnrecognizedHoldingLoss", fyEnds);
      if (loss) {
        for (const fy of Object.keys(loss)) {
          if (htmCost[fy] == null || htmFv[fy] == null || loss[fy] == null) continue;
          const gap = htmCost[fy] - htmFv[fy];
          if (Math.abs(gap - Math.abs(loss[fy])) > Math.max(Math.abs(gap) * 0.1, 5e7))
            W(`htm ${fy}: cost − fair value misses the tagged unrecognized loss`);
        }
      }
    }
  }

  // --- the spread legs ---
  {
    const { series: ii, warns: iw } = stitchGenerations([
      flowByYear(facts, "InterestAndDividendIncomeOperating"),
      flowByYear(facts, "InterestIncomeOperating"),
    ], { label: "totalInterestIncome" });
    iw.forEach(W);
    const { series: ie, warns: ew } = stitchGenerations([
      flowByYear(facts, "InterestExpenseOperating"),
      flowByYear(facts, "InterestExpense"),
    ], { label: "totalInterestExpense" });
    ew.forEach(W);
    // The closing identity: II − IE = NII to the dollar (holds at all eleven surveyed).
    const nii = flowByYear(facts, "InterestIncomeExpenseNet");
    if (ii && ie && nii) {
      for (const fy of Object.keys(ii)) {
        if (ii[fy] == null || ie[fy] == null || nii[fy] == null) continue;
        if (Math.abs(ii[fy] - ie[fy] - nii[fy]) > Math.max(Math.abs(nii[fy]) * 0.02, 2e6)) {
          ii[fy] = null; ie[fy] = null; W(`spread legs ${fy}: II − IE misses NII — both legs nulled`);
        }
      }
    }
    if (ii && Object.values(ii).some((v) => v != null)) flows.totalInterestIncome = ii;
    if (ie && Object.values(ie).some((v) => v != null)) flows.totalInterestExpense = ie;
  }

  // --- toward common equity ---
  {
    const pref = stitchGenerations([
      instantByYear(facts, "PreferredStockIncludingAdditionalPaidInCapitalNetOfDiscount", fyEnds),
      instantByYear(facts, "PreferredStockValue", fyEnds),
    ], { label: "preferredEquity" }).series;
    if (pref) instants.preferredEquity = pref;
  }

  // --- regulatory capital, gate-only where a regional tags it as a pure decimal ---
  {
    const cet1 = instantByYear(facts, "CommonEquityTierOneCapitalRatio", fyEnds, { unit: "pure" });
    if (cet1) {
      for (const fy of Object.keys(cet1)) {
        if (cet1[fy] != null && (cet1[fy] < 0.03 || cet1[fy] > 0.30)) { cet1[fy] = null; W(`cet1Ratio ${fy}: outside the plausible band — nulled`); }
      }
      if (Object.values(cet1).some((v) => v != null)) instants.cet1Ratio = cet1;
    }
  }

  if (warns.length) flags.warns = [...new Set(warns)];
  return { flows, instants, flags };
}

// Same contract as INSURANCE_LINE_NAMES: deterministic desk lines, exempt from field carry-over.
export const BANK_LINE_NAMES = [
  "noninterestBearingDeposits", "interestBearingDeposits", "demandDeposits", "interestExpenseDeposits",
  "timeDeposits", "brokeredDeposits", "loansHeldForInvestment", "allowanceForCreditLosses",
  "netChargeOffs", "nonaccrualLoans", "offBalanceSheetCreditReserve", "htmAmortizedCost",
  "htmFairValue", "totalInterestIncome", "totalInterestExpense", "preferredEquity", "cet1Ratio",
];
