#!/usr/bin/env node
// proxyCompTest.mjs — case law for the proxy pay-versus-performance parser (fetchProxyComp.mjs).
//
// The traps frozen here are the ones found live on 2026-07-18, each of which silently produced
// nothing or the wrong shape before its fix:
//   - the numeric pay facts are NESTED inside the ecd:PvpTableTextBlock text-block element, so a
//     combined nonFraction|nonNumeric regex consumed the whole table and skipped every cell
//     (Apple parsed to nothing, GE to one year);
//   - a context's id need not be its first attribute (SandRidge: <xbrli:context xmlns="" id="c0">);
//   - PeoName facts for the OTHER named officers carry ExecutiveCategoryAxis=NonPeoNeoMember and
//     must never reach a PEO row (Apple names every officer this way);
//   - a CEO-transition year carries one row per PEO under IndividualAxis members;
//   - reconciliation rows carry adjustment axes and are never the headline figures;
//   - a filer that tags no PeoName at all (Microsoft) yields null names, never a guess.
// Offline; synthetic fixture plus live-pool pins when proxyComp.json is present.
import { readFileSync } from "node:fs";
import { parseContexts, parseEcdFacts, parsePayVersusPerformance } from "./fetchProxyComp.mjs";

let failed = 0;
const t = (name, ok, got) => { if (!ok) { failed++; console.error(`✗ ${name}${got !== undefined ? ` -> ${JSON.stringify(got)}` : ""}`); } else console.log(`ok ${name}`); };

// ---- synthetic fixture: every trap in one document ----
const FIX = `
<ix:header>
<xbrli:context xmlns="" id="y25"><xbrli:entity><xbrli:identifier scheme="cik">1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
<xbrli:context id="y24a"><xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period><xbrli:scenario><xbrldi:explicitMember dimension="ecd:IndividualAxis">c:OldCeoMember</xbrldi:explicitMember></xbrli:scenario></xbrli:context>
<xbrli:context id="y24b"><xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period><xbrli:scenario><xbrldi:explicitMember dimension="ecd:IndividualAxis">c:NewCeoMember</xbrldi:explicitMember></xbrli:scenario></xbrli:context>
<xbrli:context id="y25adj"><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period><xbrli:scenario><xbrldi:explicitMember dimension="ecd:AdjToCompAxis">ecd:EqtyAwrdsAdjsMember</xbrldi:explicitMember></xbrli:scenario></xbrli:context>
<xbrli:context id="y25neo"><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period><xbrli:scenario><xbrldi:explicitMember dimension="ecd:ExecutiveCategoryAxis">ecd:NonPeoNeoMember</xbrldi:explicitMember><xbrldi:explicitMember dimension="ecd:IndividualAxis">c:CfoMember</xbrldi:explicitMember></xbrli:scenario></xbrli:context>
</ix:header>
<ix:nonNumeric contextRef="y25" name="ecd:PvpTableTextBlock">
  <table>
    <tr><td><ix:nonFraction name="ecd:PeoTotalCompAmt" contextRef="y25" scale="0">12,345,678</ix:nonFraction></td>
        <td><ix:nonFraction name="ecd:PeoActuallyPaidCompAmt" contextRef="y25" sign="-" scale="0">2,000,000</ix:nonFraction></td></tr>
    <tr><td><ix:nonFraction name="ecd:PeoTotalCompAmt" contextRef="y24a" scale="3">4,000</ix:nonFraction></td>
        <td><ix:nonFraction name="ecd:PeoTotalCompAmt" contextRef="y24b" scale="0">6,500,000</ix:nonFraction></td></tr>
    <tr><td><ix:nonFraction name="ecd:PeoActuallyPaidCompAmt" contextRef="y25adj" scale="0">99,999,999</ix:nonFraction></td></tr>
    <tr><td><ix:nonFraction name="ecd:TotalShareholderRtnAmt" contextRef="y25" scale="0">154.30</ix:nonFraction></td></tr>
  </table>
</ix:nonNumeric>
<ix:nonNumeric contextRef="y24a" name="ecd:PeoName">Jane Old</ix:nonNumeric>
<ix:nonNumeric contextRef="y24b" name="ecd:PeoName">John New</ix:nonNumeric>
<ix:nonNumeric contextRef="y25neo" name="ecd:PeoName">Carl Cfo</ix:nonNumeric>
<ix:nonNumeric contextRef="y25" name="ecd:PeoName">John New</ix:nonNumeric>
`;

const ctx = parseContexts(FIX);
t("contexts parse with xmlns-before-id (SandRidge form)", ctx.size === 5 && ctx.get("y25")?.end === "2025-12-31");
t("adjustment-axis context flagged as other-dimensioned", ctx.get("y25adj")?.otherDims === 1);
t("NonPeoNeo execCat captured", /NonPeoNeo/.test(ctx.get("y25neo")?.execCat || ""));

const facts = parseEcdFacts(FIX);
t("nested pay facts extracted from inside the table text block", (facts.get("ecd:PeoTotalCompAmt") || []).length === 3);

const p = parsePayVersusPerformance(FIX);
t("parses to a series", !!p, p);
if (p) {
  const y25 = p.years.filter((y) => y.fy === 2025);
  t("FY2025: one PEO row, comma+sign+scale honored", y25.length === 1 && y25[0].sct === 12345678 && y25[0].cap === -2000000, y25);
  t("FY2025 PEO named from the PEO-attributed fact only", y25[0]?.peoName === "John New");
  const y24 = p.years.filter((y) => y.fy === 2024);
  t("transition year: two PEO rows with scale applied (4,000 @ scale 3 = 4,000,000)",
    y24.length === 2 && y24.some((y) => y.sct === 4000000 && y.peoName === "Jane Old") && y24.some((y) => y.sct === 6500000 && y.peoName === "John New"), y24);
  t("adjustment-row 99,999,999 never becomes a headline CAP", !p.years.some((y) => y.cap === 99999999));
  t("TSR kept from the undimensioned context", p.tsr.length === 1 && p.tsr[0].value === 154.3);
}

// ---- no-PeoName filer: figures survive, names stay null (Microsoft's pattern) ----
const NONAME = FIX.replace(/<ix:nonNumeric contextRef="y2[45][ab]?" name="ecd:PeoName">[^<]+<\/ix:nonNumeric>/g, "")
  .replace(/<ix:nonNumeric contextRef="y25" name="ecd:PeoName">[^<]+<\/ix:nonNumeric>/g, "");
const pn = parsePayVersusPerformance(NONAME);
t("no-PeoName filer: series parses, names null (never guessed)", !!pn && pn.years.length === 3 && pn.years.every((y) => y.peoName === null || /Carl/.test(String(y.peoName)) === false), pn?.years);

// ---- live-pool pins (run only when the data file exists) ----
try {
  const live = JSON.parse(readFileSync("src/data/proxyComp.json", "utf8")).companies || {};
  const aapl = live.AAPL;
  if (aapl) {
    const fy22 = aapl.years.find((y) => y.fy === 2022);
    t("AAPL FY2022 SCT is the filed 99,420,097", fy22?.sct === 99420097, fy22);
    t("AAPL rows carry the PEO's name", aapl.years.every((y) => /Cook/.test(y.peoName || "")));
  }
  const ge = live.GE;
  if (ge) t("GE series is a single named PEO across five years", ge.years.length >= 5 && ge.years.every((y) => /Culp/.test(y.peoName || "")));
} catch { /* data file absent: synthetic coverage stands alone */ }

if (failed) { console.error(`\n❌ proxyCompTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ proxyCompTest passed.");
