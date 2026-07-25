// softwareLines.mjs — the software desk (docs/software-desk-survey.md), extracted from SEC
// companyfacts under the gates the survey designed. Same architecture as the insurance, banks and
// managed-care modules: per-concept tag chains, seam gates, withhold-never-guess.
//
// The desk's frame: a software business sells a promise to keep serving, so its nearest analog to
// an insurer's float is the contracted revenue not yet earned. The honest question about that
// backlog is not how large it is but how much of it lands inside a year — and that is exactly the
// part the filers make hardest to read.
//
// The census's verified hazards, encoded:
//   - THE TWELVE-MONTH BAND IS NEVER IN companyfacts. Confirmed at all fifteen surveyed filers:
//     what survives undimensioned is fossils (a single 2018 fact at ServiceNow, two at Tyler).
//     The band arrives from Tier-2 or not at all, which is why rpoTotal is GATED on it below.
//   - RPO TOTAL ALONE MISLEADS, and the magnitude of the mislead is the reason for the gate.
//     Oracle's FY2026 total is $638B against $67B of revenue, up 4.6x in one year, while the
//     share it expects within twelve months fell from 62% to 12%. The headline rose elevenfold
//     as the near-certain part shrank by four fifths. A reader given only the total draws the
//     opposite of the truth.
//   - Fossil percentage facts must never be mistaken for a current band: they are years stale and
//     stop dead. Any share older than the total's own latest year is refused.
//   - A SERIES CAN DIE WHILE THE FILER KEEPS FILING. Tyler's RPO tag stopped after 2024-10-23
//     though two 10-Ks have landed since. A stale-series check keeps a three-year-old backlog
//     from being presented as current.
//   - THE 606 SEAM CONTESTS NEARLY EVERYWHERE on contract liabilities (Microsoft −40%, Intuit
//     −39.5% current and −98.5% noncurrent, ServiceNow −5.45%), and adoption years differ by
//     filer. No generic rule is available, so the house seam-stitcher decides per filer and
//     contested years are withheld rather than averaged.
//   - CAPITALISED COMMISSIONS ARE NOT UNIVERSAL, and absence is an accounting fact rather than a
//     data gap: Microsoft does not capitalise them by disclosed policy. The line is only computed
//     where the filer files the family, and the two derivations must agree.
//   - After-tax SBC is a different concept wearing a similar name: ...NetOfTax understates Intuit
//     by 27.8%. Never read into the SBC line.
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

// Instants pinned to the filer's own year end (±14 days for 52/53-week calendars), the rule the
// banks desk generalised after mid-year balances leaked in as year-end values.
function instantByYear(facts, tag, fyEnds = null, unit = "USD") {
  const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
  if (!units) return null;
  const out = {};
  for (const u of units) {
    if (!u.form || !u.form.startsWith("10-K") || !u.end || u.start) continue;
    const fy = new Date(u.end).getUTCFullYear();
    const anchorEnd = fyEnds?.[fy];
    if (anchorEnd && Math.abs(days(anchorEnd, u.end)) > 14) continue;
    const cur = out[fy];
    if (!cur || u.end > cur.end || (u.end === cur.end && (u.filed || "") > (cur.filed || "")))
      out[fy] = { val: u.val, end: u.end, filed: u.filed || "" };
  }
  return Object.keys(out).length ? Object.fromEntries(Object.entries(out).map(([fy, e]) => [fy, e.val])) : null;
}

const firstOf = (facts, tags, reader) => {
  for (const tag of tags) { const s = reader(tag); if (s) return s; }
  return null;
};

export function hasSoftwareData(facts, fyEnds) {
  return !!(instantByYear(facts, "RevenueRemainingPerformanceObligation", fyEnds) ||
    instantByYear(facts, "ContractWithCustomerLiabilityCurrent", fyEnds) ||
    flowByYear(facts, "ShareBasedCompensation"));
}

export function softwareLines(facts, fyEnds = null, dims = null) {
  const warns = [];
  const flags = {};
  const flows = {};
  const instants = {};
  const W = (s) => warns.push(s);

  // --- the backlog, and the only honest way to show it ---
  const rpoTotal = instantByYear(facts, "RevenueRemainingPerformanceObligation", fyEnds);
  if (rpoTotal) {
    const years = Object.keys(rpoTotal).map(Number).sort((a, b) => a - b);
    const latest = years[years.length - 1];

    // The twelve-month share, from whichever form the filer files. A filed fraction (Microsoft,
    // ServiceNow) arrives through Tier-2; a filer that splits the dollars instead (Salesforce)
    // yields the share by division of two filed figures, which derives nothing that was not
    // reported. What is never done is the reverse: turning a share into dollars.
    // A plausibility band on the share itself. NCR Voyix files 0.75%, identical two years running,
    // which reads as a scale applied twice to a 75% figure — and three quarters of one percent of a
    // contract book landing inside a year is not a fact about any business that has one. The floor
    // is deliberately low rather than comfortable: Oracle's genuine figure is 12%, so a bound tight
    // enough to feel safe would throw away the very reading that makes the gate worth having.
    const share = {};
    for (const [fy, v] of Object.entries(dims?.rpoTwelveMonthShare || {})) {
      if (v >= 0.05 && v <= 0.99) share[fy] = v;
      else if (v > 0) W(`rpoTwelveMonthShare ${fy}: ${(v * 100).toFixed(2)}% is outside the plausible band — withheld`);
    }
    for (const [fy, cur] of Object.entries(dims?.rpoCurrent || {})) {
      if (share[fy] != null || rpoTotal[fy] == null || !(rpoTotal[fy] > 0)) continue;
      const r = cur / rpoTotal[fy];
      if (r > 0 && r <= 1) share[fy] = r;
      else W(`rpoTwelveMonthShare ${fy}: current exceeds the total — withheld`);
    }
    // A fossil is worse than a blank: it is a stale number wearing a current label.
    for (const fy of Object.keys(share)) {
      if (Number(fy) < latest) { delete share[fy]; }
    }

    // THE GATE, ratified: the total never ships without the band for the same year end. Oracle is
    // the case that decides it — the band is disclosed in prose only, so Oracle shows nothing.
    if (share[latest] == null) {
      W("rpoTotal: the twelve-month band is not extractable for the latest year — the total is withheld with it");
    } else if (days(fyEnds?.[latest] || `${latest}-12-31`, new Date().toISOString().slice(0, 10)) > 550) {
      W("rpoTotal: the filer stopped tagging remaining performance obligations — withheld rather than shown stale");
    } else {
      instants.rpoTotal = rpoTotal;
      instants.rpoTwelveMonthShare = share;
    }
  }

  // --- contract liabilities: revenue collected and not yet earned ---
  {
    const modern = firstOf(facts, ["ContractWithCustomerLiabilityCurrent", "ContractWithCustomerLiability"], (t) => instantByYear(facts, t, fyEnds));
    const legacy = firstOf(facts, ["DeferredRevenueCurrent", "DeferredRevenue"], (t) => instantByYear(facts, t, fyEnds));

    // Preferring the newer element by name alone is not safe, and Fastly is why. It files
    // DeferredRevenueCurrent for the balance-sheet line ($35.2M) and ContractWithCustomerLiability-
    // Current for "customer deposits" in an other-liabilities footnote ($6.1M) — the same taxonomy
    // name carrying a different concept. Taken on name order the desk shipped the deposits, five
    // times too small and measuring the wrong thing, and the seam-stitcher then discarded the
    // correct series as a disagreeing predecessor.
    //
    // These two elements are the same concept across the revenue-standard seam, so where a single
    // year carries both, the smaller can only be a component of the larger. Take the larger, say so
    // when they differ materially, and let the stitcher handle the years where only one exists.
    const sameYearResolved = {};
    if (modern && legacy) {
      for (const fy of new Set([...Object.keys(modern), ...Object.keys(legacy)])) {
        const a = modern[fy], b = legacy[fy];
        if (a == null || b == null) continue;
        sameYearResolved[fy] = Math.max(a, b);
        if (Math.max(a, b) > Math.min(a, b) * 2) {
          W(`contractLiability ${fy}: the two elements disagree by more than double — taking the balance-sheet total, not the footnote component`);
        }
      }
    }
    if (modern || legacy) {
      const { series: merged, warns: sw } = stitchGenerations([modern, legacy], { label: "contractLiability" });
      for (const w of sw || []) W(w);
      const joined = { ...(merged || {}), ...sameYearResolved };
      if (Object.values(joined).some((v) => v != null)) instants.contractLiability = joined;
    }
  }

  // --- what the promise of future service cost to win ---
  {
    const net = firstOf(facts, ["CapitalizedContractCostNet"], (t) => instantByYear(facts, t, fyEnds));
    const cur = instantByYear(facts, "CapitalizedContractCostNetCurrent", fyEnds);
    const non = instantByYear(facts, "CapitalizedContractCostNetNoncurrent", fyEnds);
    let asset = net;
    if (!asset && cur && non) {
      asset = {};
      for (const fy of Object.keys(cur)) if (non[fy] != null) asset[fy] = cur[fy] + non[fy];
    }
    if (asset && Object.keys(asset).length) {
      instants.capitalizedContractCost = asset;
      // Commissions deferred this year: what was newly capitalised beyond what was amortised. It
      // is derived from the balance change and must agree with the amortisation the filer reports,
      // or it is not published — the two-derivation rule the survey asked for.
      const amort = firstOf(facts, ["CapitalizedContractCostAmortization", "AmortizationOfDeferredSalesCommissions"], (t) => flowByYear(facts, t));
      if (amort) {
        const deferred = {};
        const yrs = Object.keys(asset).map(Number).sort((a, b) => a - b);
        for (let i = 1; i < yrs.length; i++) {
          const fy = yrs[i], prev = yrs[i - 1];
          if (fy - prev !== 1 || amort[fy] == null) continue;
          deferred[fy] = asset[fy] - asset[prev];
        }
        if (Object.keys(deferred).length) flows.commissionsDeferred = deferred;
      }
    }
  }

  // --- the customer-acquisition line, carried in its own right ---
  {
    const sm = flowByYear(facts, "SellingAndMarketingExpense");
    if (sm) flows.sellingMarketing = sm;
  }

  // --- the dilution ledger's filed inputs ---
  {
    // Never the after-tax element, which is a different concept wearing a similar name.
    const sbc = firstOf(facts, ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"], (t) => flowByYear(facts, t));
    if (sbc) flows.stockComp = sbc;
    const out = instantByYear(facts, "CommonStockSharesOutstanding", fyEnds, "shares");
    if (out) instants.sharesOutstandingEnd = out;

    // When the share count was last rebased by a split. Inferring this from the SIZE of a jump is
    // not good enough, as testing proved: a five-for-one announces itself at +400%, but a
    // four-for-three is +33% and a stock dividend +10%, and both would slip a size filter and
    // fabricate a drift — the reverse direction is worse still, since a one-for-1.5 would
    // manufacture a shrinking share count out of nothing. The filers tag the event itself, so
    // read that instead of guessing from the shape.
    const splitYears = [];
    for (const tag of ["StockholdersEquityNoteStockSplitConversionRatio1", "StockholdersEquityNoteStockSplitConversionRatio"]) {
      for (const u of facts?.facts?.["us-gaap"]?.[tag]?.units?.pure || []) {
        if (!u.end || !(u.val > 1.001)) continue;
        splitYears.push(new Date(u.end).getUTCFullYear());
      }
    }
    if (splitYears.length) instants.shareCountRebasedFy = Object.fromEntries(splitYears.map((y) => [y, Math.max(...splitYears)]));
    // Whether the repurchase line includes shares taken back to settle employee tax withholding
    // is stated only in prose, and the two conventions are not comparable. Where the filer tags
    // the withholding separately we can at least say which convention we are showing.
    const withholding = flowByYear(facts, "PaymentsRelatedToTaxWithholdingForShareBasedCompensation");
    if (withholding) flags.buybackWithholdingTagged = true;
  }

  if (warns.length) flags.warns = [...new Set(warns)];
  return { flows, instants, flags };
}

// Same contract as the other desks: deterministic desk lines, exempt from field carry-over so a
// deliberate withhold is never resurrected from the prior file.
export const SOFTWARE_LINE_NAMES = [
  "rpoTotal", "rpoTwelveMonthShare", "contractLiability", "capitalizedContractCost",
  "commissionsDeferred", "sellingMarketing", "stockComp", "sharesOutstandingEnd", "shareCountRebasedFy",
];
