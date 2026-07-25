// softwareDeskTest.mjs — case law for the software desk (docs/software-desk-survey.md).
//
// The gates under test are the ones that decide whether a number ships at all:
//   - the backlog total NEVER ships without the twelve-month band that qualifies it (Oracle);
//   - the band is published as filed and never multiplied back into dollars beyond the filed
//     arithmetic;
//   - the share-count drift is withheld where a split or a first listing sits in the window
//     (ServiceNow's five-for-one, Snowflake's IPO), because the shape cannot be real;
//   - the drift is measured over three years, since a longer window reverses the sign for
//     companies that changed course (Oracle stopped buying back, Salesforce started).
import { softwareLines } from "./softwareLines.mjs";
import { backlogCheck, dilutionCheck, acquisitionCheck } from "../src/lib/software.mjs";
import { typedContextMatches, parseContexts, parseDurationMonths, extractBandShare } from "./fetchDimensional.mjs";

let failed = 0;
const t = (name, ok, got) => {
  if (!ok) { failed++; console.error(`✗ ${name}${got !== undefined ? ` -> ${JSON.stringify(got)}` : ""}`); }
  else console.log(`ok ${name}`);
};

const AXIS = "us-gaap:RevenueRemainingPerformanceObligationExpectedTimingOfSatisfactionStartDateAxis";
const PERIOD = "us-gaap:RevenueRemainingPerformanceObligationExpectedTimingOfSatisfactionPeriod1";

const mkFacts = (rows) => ({ facts: { "us-gaap": Object.fromEntries(rows.map(([tag, vals, unit]) => [tag, { units: { [unit || "USD"]: vals } }])) } });
const inst = (end, val) => ({ form: "10-K", end, val, filed: `${Number(end.slice(0, 4)) + 1}-02-01` });

// --- 1. the RPO gate: no total without the band ---
{
  const facts = mkFacts([["RevenueRemainingPerformanceObligation", [inst("2025-12-31", 638e9)]]]);
  const bare = softwareLines(facts, { 2025: "2025-12-31" }, null);
  t("Oracle's shape: a total with no band ships nothing", bare.instants.rpoTotal === undefined, bare.instants);
  t("and it says why", (bare.flags.warns || []).some((w) => /twelve-month band/.test(w)), bare.flags);

  const withBand = softwareLines(facts, { 2025: "2025-12-31" }, { rpoTwelveMonthShare: { 2025: 0.4 } });
  t("a filed band lets the total through", withBand.instants.rpoTotal?.[2025] === 638e9);
  t("and the band rides with it", withBand.instants.rpoTwelveMonthShare?.[2025] === 0.4);
}

// --- 2. Salesforce's shape: the share is a quotient of two filed dollar figures ---
{
  const facts = mkFacts([["RevenueRemainingPerformanceObligation", [inst("2026-01-31", 72.4e9)]]]);
  const out = softwareLines(facts, { 2026: "2026-01-31" }, { rpoCurrent: { 2026: 35.1e9 } });
  const share = out.instants.rpoTwelveMonthShare?.[2026];
  t("current ÷ total gives the band without inventing anything", Math.abs(share - 35.1 / 72.4) < 1e-9, share);
}

// --- 3. a fossil band never qualifies a current total ---
{
  // ServiceNow's only undimensioned percentage fact is from a 2018 10-Q. A band years older than
  // the total it would qualify is a stale number wearing a current label.
  const facts = mkFacts([["RevenueRemainingPerformanceObligation", [inst("2025-12-31", 28.2e9)]]]);
  const out = softwareLines(facts, { 2025: "2025-12-31" }, { rpoTwelveMonthShare: { 2018: 0.51 } });
  t("a 2018 band does not license a 2025 total", out.instants.rpoTotal === undefined, out.instants);
}

// --- 4. the typed-context rule, and the decoys it must refuse ---
{
  const DOC = `
<xbrli:context id="band12">
  <xbrli:period><xbrli:instant>2025-06-30</xbrli:instant></xbrli:period>
  <xbrli:segment><xbrldi:typedMember dimension="${AXIS}"><x:${AXIS}.domain>2025-07-01</x:${AXIS}.domain></xbrldi:typedMember></xbrli:segment>
</xbrli:context>
<xbrli:context id="decoyRange">
  <xbrli:period><xbrli:instant>2025-06-30</xbrli:instant></xbrli:period>
  <xbrli:segment>
    <xbrldi:explicitMember dimension="srt:RangeAxis">srt:MinimumMember</xbrldi:explicitMember>
    <xbrldi:typedMember dimension="${AXIS}"><x:${AXIS}.domain>2025-07-01</x:${AXIS}.domain></xbrldi:typedMember>
  </xbrli:segment>
</xbrli:context>
<xbrli:context id="decoyLater">
  <xbrli:period><xbrli:instant>2025-06-30</xbrli:instant></xbrli:period>
  <xbrli:segment><xbrldi:typedMember dimension="${AXIS}"><x:${AXIS}.domain>2026-07-01</x:${AXIS}.domain></xbrldi:typedMember></xbrli:segment>
</xbrli:context>
<ix:nonFraction name="us-gaap:RevenueRemainingPerformanceObligationPercentage" contextRef="band12" unitRef="U_pure" scale="-2">40</ix:nonFraction>
<ix:nonFraction name="us-gaap:RevenueRemainingPerformanceObligationPercentage" contextRef="decoyLater" unitRef="U_pure" scale="-2">60</ix:nonFraction>
<ix:nonNumeric name="${PERIOD}" contextRef="band12" format="ixt-sec:durmonth">12</ix:nonNumeric>
<ix:nonNumeric name="${PERIOD}" contextRef="decoyLater" format="ixt-sec:durmonth">24</ix:nonNumeric>
`;
  const ctxs = parseContexts(DOC);
  t("a typed member is captured with its axis and content", ctxs.band12.typedDims[0]?.content === "2025-07-01", ctxs.band12.typedDims);
  t("the band context matches all three marks", typedContextMatches(ctxs.band12, { axis: AXIS }) === true);
  t("an explicit range member breaks the match", typedContextMatches(ctxs.decoyRange, { axis: AXIS }) === false);
  t("a start date a year out breaks the match", typedContextMatches(ctxs.decoyLater, { axis: AXIS }) === false);
  t("duration months parse from ix:nonNumeric", parseDurationMonths(DOC, PERIOD).find((d) => d.contextRef === "band12")?.months === 12);

  const series = extractBandShare(DOC, { tag: "us-gaap:RevenueRemainingPerformanceObligationPercentage", axis: AXIS, periodTag: PERIOD });
  t("only the twelve-month band is extracted, at its filed scale", series[2025] === 0.4 && Object.keys(series).length === 1, series);
}

// --- 5. the dilution ledger ---
{
  const mk = (shares) => ({
    lines: { stockComp: 2e9, buybacks: 1e9, revenue: 13e9, sharesDiluted: shares[shares.length - 1][1] },
    history: shares.map(([fy, v]) => ({ fy, lines: { sharesDiluted: v } })),
  });
  // ServiceNow's five-for-one: a single year jumping fivefold is not an issuance, it is a rebasing.
  const split = dilutionCheck(mk([[2022, 205], [2023, 210], [2024, 215], [2025, 1075]]));
  t("a split withholds the drift rather than printing +400%", /not comparable/.test(split.formula), split.formula);
  t("and the check still reports the pay packet", /Stock compensation/.test(split.formula));

  // Oracle's shape: the count rising again after the buyback stopped.
  const rising = dilutionCheck(mk([[2023, 2766], [2024, 2823], [2025, 2866], [2026, 2914]]));
  t("a rising count reads as rising", rising.label === "The count is rising", rising.label);

  // Microsoft's shape, and the calibration the verifiers corrected: $57.9B of repurchases moved
  // the diluted count one percent and the outstanding count not at all. That is a buyback
  // cancelling a pay packet, not an owner's slice growing, and the label must say so.
  const flat = dilutionCheck(mk([[2022, 7540], [2023, 7472], [2024, 7469], [2025, 7465]]));
  t("a large buyback that moves the count 1% reads as standing still", flat.label === "The buyback only stands still", flat.label);
  // Adobe's shape: a count genuinely down a tenth over three years.
  const real = dilutionCheck(mk([[2022, 480], [2023, 460], [2024, 445], [2025, 435]]));
  t("a count down a tenth is genuinely shrinking", real.label === "The count is genuinely shrinking", real.label);
  // A split sitting just OUTSIDE the measured window still contaminates the baseline.
  const edge = dilutionCheck(mk([[2021, 200], [2022, 1000], [2023, 1010], [2024, 1015], [2025, 1020]]));
  t("a split at the window edge is still caught", /not comparable/.test(edge.formula), edge.formula);

  t("no stock compensation means no check at all", dilutionCheck({ lines: { revenue: 10 } }) === null);
}

// --- 6. the backlog and acquisition reads ---
{
  const co = { lines: { rpoTotal: 28.2e9, rpoTwelveMonthShare: 0.46, revenue: 13.3e9, sellingMarketing: 4.4e9 } };
  const b = backlogCheck(co);
  t("coverage is the year's contracted revenue over a year of revenue", b.value === "98%", b.value);
  t("the formula shows the total, the band, and the product", /375|28\.2B/.test(b.formula) && /46%/.test(b.formula), b.formula);
  t("no band means no backlog check", backlogCheck({ lines: { rpoTotal: 1e9, revenue: 1e9 } }) === null);
  t("selling cost reads against revenue", acquisitionCheck(co).value === "33%", acquisitionCheck(co).value);
}

// --- 6b. the plausibility band on the share ---
{
  const facts = mkFacts([["RevenueRemainingPerformanceObligation", [inst("2025-12-31", 3e9)]]]);
  const daft = softwareLines(facts, { 2025: "2025-12-31" }, { rpoTwelveMonthShare: { 2025: 0.0075 } });
  t("a 0.75% band is refused, and the total withheld with it", daft.instants.rpoTotal === undefined, daft.instants);
  t("and it says why", (daft.flags.warns || []).some((w) => /plausible band/.test(w)));
  // Oracle's real figure is 12%: the floor must not throw away a genuinely low but honest band.
  const low = softwareLines(facts, { 2025: "2025-12-31" }, { rpoTwelveMonthShare: { 2025: 0.12 } });
  t("a genuinely low band still ships", low.instants.rpoTwelveMonthShare?.[2025] === 0.12);
}

// --- 7. what the hostile verification caught (2026-07-25) ---
{
  // Fastly files DeferredRevenueCurrent for the balance-sheet line and ContractWithCustomer-
  // LiabilityCurrent for "customer deposits" in an other-liabilities footnote. Preferring the
  // newer element by name shipped the deposits: five times too small, and the wrong concept.
  const fsly = mkFacts([
    ["ContractWithCustomerLiabilityCurrent", [inst("2025-12-31", 6115000), inst("2024-12-31", 1213000)]],
    ["DeferredRevenueCurrent", [inst("2025-12-31", 35234000), inst("2024-12-31", 26511000)]],
  ]);
  const out = softwareLines(fsly, { 2025: "2025-12-31", 2024: "2024-12-31" }, null);
  t("the balance-sheet total beats the footnote component", out.instants.contractLiability?.[2025] === 35234000, out.instants.contractLiability);
  t("and it says which one it took", (out.flags.warns || []).some((w) => /footnote component/.test(w)));

  // ServiceNow tags its five-for-one split, so read the event rather than inferring one from the
  // size of the jump: a four-for-three is +33% and a stock dividend +10%, and a size filter calibrated
  // to catch a fivefold rebasing would let both through and fabricate a drift.
  const mk = (shares, extra = {}) => ({
    lines: { stockComp: 2e9, buybacks: 1e9, revenue: 13e9, sharesDiluted: shares[shares.length - 1][1], ...extra },
    history: shares.map(([fy, v]) => ({ fy, lines: { sharesDiluted: v } })),
  });
  const small = dilutionCheck(mk([[2022, 300], [2023, 310], [2024, 320], [2025, 427]], { shareCountRebasedFy: 2025 }));
  t("a four-for-three split is caught because the filer tagged it, not because it was large", /not comparable/.test(small.formula), small.formula);
  const old = dilutionCheck(mk([[2022, 300], [2023, 310], [2024, 320], [2025, 330]], { shareCountRebasedFy: 2015 }));
  t("a split long before the window withholds nothing", !/not comparable/.test(old.formula), old.formula);
}

if (failed) { console.error(`\n❌ softwareDeskTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ softwareDeskTest passed.");
