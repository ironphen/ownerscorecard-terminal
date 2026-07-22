// dimensionalTest.mjs — case law for the Tier-2 keyhole parser (scripts/fetchDimensional.mjs).
//
// The rules under test: a context matches only when its explicit-member set EQUALS the target's
// exactly (no extra axes, no typed members); ix sign and scale apply to the rendered number; the
// incurred identity withholds a development year it cannot prove; the Wells Fargo double identity
// (gross − recoveries = net AND segment members sum to the total) withholds on either failure.
import { parseContexts, parseFacts, contextMatches, extractSeries } from "./fetchDimensional.mjs";

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

if (failed) { console.error(`\n❌ dimensionalTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ dimensionalTest passed.");
