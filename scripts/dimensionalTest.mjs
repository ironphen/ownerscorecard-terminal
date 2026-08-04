// dimensionalTest.mjs — case law for the Tier-2 keyhole parser (scripts/fetchDimensional.mjs).
//
// The rules under test: a context matches only when its explicit-member set EQUALS the target's
// exactly (no extra axes, no typed members); ix sign and scale apply to the rendered number; the
// incurred identity withholds a development year it cannot prove; the Wells Fargo double identity
// (gross − recoveries = net AND segment members sum to the total) withholds on either failure.
// The capex targets add two rules of their own: a component sum is ALL OR NOTHING per year (a
// missing leg yields no figure rather than a short one), and the member census withholds any year
// whose axis carries a member the registry never classified as plant built or plant bought.
import { parseContexts, parseFacts, contextMatches, extractSeries, extractComponentSum, membersOnAxis, TARGETS } from "./fetchDimensional.mjs";

let failed = 0;
const t = (name, ok, got) => { if (!ok) { failed++; console.error(`✗ ${name}${got !== undefined ? ` -> ${JSON.stringify(got)}` : ""}`); } else console.log(`ok ${name}`); };

const DOC = `
<xbrli:context id="c-seg">
  <xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period>
  <xbrli:segment><xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">us-gaap:PropertyLiabilityAndCasualtyInsuranceSegmentMember</xbrldi:explicitMember></xbrli:segment>
</xbrli:context>
<xbrli:context id="c-two-dims">
  <xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period>
  <xbrli:segment>
    <xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">us-gaap:PropertyLiabilityAndCasualtyInsuranceSegmentMember</xbrldi:explicitMember>
    <xbrldi:explicitMember dimension="us-gaap:NoncatastrophicEventAxis">x:SomeDriverMember</xbrldi:explicitMember>
  </xbrli:segment>
</xbrli:context>
<xbrli:context id="c-typed">
  <xbrli:period><xbrli:instant>2025-06-30</xbrli:instant></xbrli:period>
  <xbrli:segment><xbrldi:typedMember dimension="us-gaap:SomeStartDateAxis"><x:domain>2025-07-01</x:domain></xbrldi:typedMember></xbrli:segment>
</xbrli:context>
<xbrli:context id="c-default">
  <xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period>
</xbrli:context>
<xbrli:context id="c-inst">
  <xbrli:period><xbrli:instant>2025-12-31</xbrli:instant></xbrli:period>
  <xbrli:segment><xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">ci:CignaHealthcareMember</xbrldi:explicitMember></xbrli:segment>
</xbrli:context>
<ix:nonFraction name="us-gaap:DevTag" contextRef="c-seg" scale="6" sign="-" format="ixt:num-dot-decimal">939</ix:nonFraction>
<ix:nonFraction name="us-gaap:DevTag" contextRef="c-two-dims" scale="6">142</ix:nonFraction>
<ix:nonFraction name="us-gaap:BalTag" contextRef="c-inst" scale="6">4,241</ix:nonFraction>
<ix:nonFraction name="wfc:NetTag" contextRef="c-default" scale="6">1,608</ix:nonFraction>
`;

// --- contexts and matching ---
{
  const ctxs = parseContexts(DOC);
  t("contexts parse with dims, periods, and the typed flag", ctxs["c-seg"].dims["srt:ProductOrServiceAxis"] === "us-gaap:PropertyLiabilityAndCasualtyInsuranceSegmentMember" && ctxs["c-typed"].typed === true && ctxs["c-inst"].instant === "2025-12-31", ctxs["c-seg"]);
  const spec = { "srt:ProductOrServiceAxis": "us-gaap:PropertyLiabilityAndCasualtyInsuranceSegmentMember" };
  t("the exact-set rule matches the single-member context", contextMatches(ctxs["c-seg"], spec, "flow") === true);
  t("an extra axis breaks the match (the driver-split context is not the total)", contextMatches(ctxs["c-two-dims"], spec, "flow") === false);
  t("a typed-member context never matches", contextMatches(ctxs["c-typed"], {}, "instant") === false);
  t("the default context matches an empty dims spec (the WFC extension case)", contextMatches(ctxs["c-default"], {}, "flow") === true);
}

// --- facts: sign, scale, formatting ---
{
  const facts = parseFacts(DOC, "us-gaap:DevTag");
  t("ix sign and scale apply (a rendered 939 becomes −939M)", facts.find((f) => f.contextRef === "c-seg")?.value === -939e6, facts);
  const bal = parseFacts(DOC, "us-gaap:BalTag");
  t("comma-formatted values parse clean", bal[0]?.value === 4241e6, bal);
}

// --- series extraction stays inside the keyhole ---
{
  const dev = extractSeries(DOC, { tag: "us-gaap:DevTag", kind: "flow", dims: { "srt:ProductOrServiceAxis": "us-gaap:PropertyLiabilityAndCasualtyInsuranceSegmentMember" } });
  t("extraction takes the exact-coordinates fact and refuses the driver split", dev[2025] === -939e6 && Object.keys(dev).length === 1, dev);
  const wfc = extractSeries(DOC, { tag: "wfc:NetTag", kind: "flow", dims: {} });
  t("a default-context extension fact extracts under the empty spec", wfc[2025] === 1608e6, wfc);
}

// --- capex: component sums, the member census, and the pinned coordinates ---
// Built in the shape CMS and New Jersey Resources actually file: the standard capex element under
// a property-type axis, one member per printed sub-line, plus an acquisition member in the year the
// filer bought a plant rather than built one.
const CAPEX_DOC = `
<xbrli:context id="c-default">
  <xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period>
</xbrli:context>
<xbrli:context id="c-ongoing-25">
  <xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period>
  <xbrli:segment><xbrldi:explicitMember dimension="us-gaap:PropertyPlantAndEquipmentByTypeAxis">cms:OngoingCapitalExpendituresMember</xbrldi:explicitMember></xbrli:segment>
</xbrli:context>
<xbrli:context id="c-ongoing-23">
  <xbrli:period><xbrli:startDate>2023-01-01</xbrli:startDate><xbrli:endDate>2023-12-31</xbrli:endDate></xbrli:period>
  <xbrli:segment><xbrldi:explicitMember dimension="us-gaap:PropertyPlantAndEquipmentByTypeAxis">cms:OngoingCapitalExpendituresMember</xbrldi:explicitMember></xbrli:segment>
</xbrli:context>
<xbrli:context id="c-covert-23">
  <xbrli:period><xbrli:startDate>2023-01-01</xbrli:startDate><xbrli:endDate>2023-12-31</xbrli:endDate></xbrli:period>
  <xbrli:segment><xbrldi:explicitMember dimension="us-gaap:PropertyPlantAndEquipmentByTypeAxis">cms:CovertPlantAcquisitionMember</xbrldi:explicitMember></xbrli:segment>
</xbrli:context>
<xbrli:context id="c-sub-25">
  <xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period>
  <xbrli:segment>
    <xbrldi:explicitMember dimension="dei:LegalEntityAxis">cms:ConsumersEnergyCompanyMember</xbrldi:explicitMember>
    <xbrldi:explicitMember dimension="us-gaap:PropertyPlantAndEquipmentByTypeAxis">cms:OngoingCapitalExpendituresMember</xbrldi:explicitMember>
  </xbrli:segment>
</xbrli:context>
<ix:nonFraction name="us-gaap:PaymentsToAcquirePropertyPlantAndEquipment" contextRef="c-ongoing-25" scale="6">3,824</ix:nonFraction>
<ix:nonFraction name="us-gaap:PaymentsToAcquirePropertyPlantAndEquipment" contextRef="c-ongoing-23" scale="6">2,407</ix:nonFraction>
<ix:nonFraction name="us-gaap:PaymentsToAcquirePropertyPlantAndEquipment" contextRef="c-covert-23" scale="6">812</ix:nonFraction>
<ix:nonFraction name="us-gaap:PaymentsToAcquirePropertyPlantAndEquipment" contextRef="c-sub-25" scale="6">3,314</ix:nonFraction>
<ix:nonFraction name="nee:CapitalExpendituresOfFPL" contextRef="c-default" scale="6">8,719</ix:nonFraction>
<ix:nonFraction name="nee:IndependentPowerInvestments" contextRef="c-default" scale="6">15,332</ix:nonFraction>
<ix:nonFraction name="us-gaap:PaymentsForProceedsFromNuclearFuel" contextRef="c-default" scale="6">553</ix:nonFraction>
`;

{
  const AXIS = "us-gaap:PropertyPlantAndEquipmentByTypeAxis";
  const ongoing = { tag: "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment", dims: { [AXIS]: "cms:OngoingCapitalExpendituresMember" } };
  const sum = extractComponentSum(CAPEX_DOC, { kind: "flow", components: [ongoing] });
  t("a one-component capex sum reads the consolidated member, not the subsidiary's column", sum[2025] === 3824e6 && sum[2023] === 2407e6, sum);

  // The acquisition member is never added: a plant bought is not a plant built (the AEP precedent).
  t("the acquisition member stays out of the component sum", sum[2023] === 2407e6, sum[2023]);

  const census = membersOnAxis(CAPEX_DOC, "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment", AXIS);
  t("the census sees both members in the acquisition year and only one in the others",
    census[2023].size === 2 && census[2023].has("cms:CovertPlantAcquisitionMember") && census[2025].size === 1, [...(census[2023] || [])]);
  t("the census ignores a member paired with a legal-entity axis (that is a subsidiary's column)",
    !([...(census[2025] || [])].some((m) => m !== "cms:OngoingCapitalExpendituresMember")), [...(census[2025] || [])]);

  // ALL OR NOTHING: NextEra's fourth component is absent from this fixture, so the year yields
  // nothing rather than a sum three-quarters of the way to the printed line.
  const partial = extractComponentSum(CAPEX_DOC + "\n", { kind: "flow", components: [
    { tag: "nee:CapitalExpendituresOfFPL", dims: {} },
    { tag: "nee:IndependentPowerInvestments", dims: {} },
    { tag: "us-gaap:PaymentsForProceedsFromNuclearFuel", dims: {} },
    { tag: "nee:OtherCapitalExpenditures", dims: {} },
  ] });
  t("a missing component withholds the whole year rather than shipping a short sum", Object.keys(partial).length === 0, partial);
  const whole = extractComponentSum(CAPEX_DOC, { kind: "flow", components: [
    { tag: "nee:CapitalExpendituresOfFPL", dims: {} },
    { tag: "nee:IndependentPowerInvestments", dims: {} },
    { tag: "us-gaap:PaymentsForProceedsFromNuclearFuel", dims: {} },
  ] });
  t("the components present sum exactly (8,719 + 15,332 + 553)", whole[2025] === 24604e6, whole);
}

// --- the registry's capex coordinates, pinned ---
// These are the exact tags, members and carve-outs that were mapped against each filer's PRINTED
// statement of cash flows. A silent edit here is a wrong capex on four company pages, so the shape
// is nailed down rather than trusted.
{
  const byTicker = Object.fromEntries(TARGETS.map((x) => [x.ticker, x]));
  const capexOf = (tk) => (byTicker[tk]?.lines || []).find((l) => l.line === "capex");
  const tagsOf = (tk) => (capexOf(tk)?.components || []).map((c) => c.tag);
  const membersOf = (tk) => (capexOf(tk)?.components || []).map((c) => Object.values(c.dims)[0]);

  t("CMS reads the ongoing-capex member alone and classifies the Covert purchase",
    membersOf("CMS").join() === "cms:OngoingCapitalExpendituresMember" &&
    byTicker.CMS.census.known.join() === "cms:OngoingCapitalExpendituresMember,cms:CovertPlantAcquisitionMember", membersOf("CMS"));
  t("NJR reads its three printed expenditure members and no fourth",
    membersOf("NJR").join() === "njr:UtilityPlantMember,njr:SolarEquipmentMember,njr:StorageAndTransportationAndOtherMember" &&
    byTicker.NJR.census.known.length === 3, membersOf("NJR"));
  t("DTE reads the utility and non-utility extension pair and nothing else",
    tagsOf("DTE").join() === "dte:PlantAndEquipmentExpendituresUtility,dte:PlantAndEquipmentExpendituresNonUtility", tagsOf("DTE"));
  t("NEE reads its four printed capital-expenditure lines",
    tagsOf("NEE").join() === "nee:CapitalExpendituresOfFPL,nee:IndependentPowerInvestments,us-gaap:PaymentsForProceedsFromNuclearFuel,nee:OtherCapitalExpenditures", tagsOf("NEE"));

  // The extension-namespace filers pay the Wells Fargo price: a gate, with a total to check against
  // and segment members to check the total, or the year is withheld.
  for (const tk of ["DTE", "NEE"]) {
    const g = byTicker[tk];
    const names = (g.gateInputs || []).map((x) => x.name);
    t(`${tk} carries the capex double identity (a total and segment members)`,
      g.gate === "capexDoubleIdentity" && names.includes("total") && names.filter((n) => n.startsWith("seg")).length >= 3, names);
  }
  // Every capex component must sit at coordinates the exact-set rule can resolve: a dimensioned
  // component names exactly one axis, an extension component names none.
  const badDims = ["CMS", "NJR", "DTE", "NEE"].flatMap((tk) => (capexOf(tk)?.components || []).filter((c) => Object.keys(c.dims).length > 1));
  t("no capex component reaches for a multi-axis context", badDims.length === 0, badDims);
}

if (failed) { console.error(`\n❌ dimensionalTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ dimensionalTest passed.");
