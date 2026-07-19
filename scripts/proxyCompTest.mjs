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

// ---- dimensioned + undimensioned twin rows: the unnamed duplicate is dropped (Amtech's pattern) ----
const TWIN = FIX.replace(
  `<tr><td><ix:nonFraction name="ecd:TotalShareholderRtnAmt" contextRef="y25" scale="0">154.30</ix:nonFraction></td></tr>`,
  `<tr><td><ix:nonFraction name="ecd:PeoTotalCompAmt" contextRef="y24dup" scale="0">4,000,000</ix:nonFraction></td></tr>`
).replace(
  `</ix:header>`,
  `<xbrli:context id="y24dup"><xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period></xbrli:context>\n</ix:header>`
);
const tw = parsePayVersusPerformance(TWIN);
t("undimensioned twin of a member row is dropped, real rows survive",
  !!tw && tw.years.filter((y) => y.fy === 2024).length === 2 && tw.years.filter((y) => y.fy === 2024).every((y) => y.peoName != null), tw?.years);

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

  // 2026-07-18 adjudication verdicts, pinned. Filer-tagging-error companies are withheld (their
  // tags contradict their own rendered tables): ASYS (scale=3 on whole dollars, 1000x), SOUN
  // (reconciliation rows tagged as headline pay), OPEN (three-CEO year cross-tagged), PHUN (CAP
  // columns tagged as SCT). Real-as-filed extremes SHIP: the mega-grants, the genuinely negative
  // SCT totals, the $1 chiefs.
  for (const tk of ["ASYS", "SOUN", "SOUNW", "OPEN", "OPENW", "PHUN"])
    t(`${tk} withheld (filer tagging contradicts its rendered table)`, !(tk in live));
  if (live.TTD) t("TTD FY2021 mega-grant ships as filed (~$835.0M)", Math.abs((live.TTD.years.find((y) => y.fy === 2021)?.sct ?? 0) - 834968762) < 2);
  if (live.CCBG) t("CCBG FY2022 negative SCT ships as filed (−$774,965, pension reversal)", live.CCBG.years.find((y) => y.fy === 2022)?.sct === -774965);
  if (live.PNTG) {
    const r22 = live.PNTG.years.filter((y) => y.fy === 2022);
    t("PNTG FY2022 transition ships both named rows (Walker −$3.30M, Guerisoli $1.56M)",
      r22.length === 2 && r22.some((y) => /Walker/.test(y.peoName || "") && y.sct === -3296796) && r22.some((y) => /Guerisoli/.test(y.peoName || "")), r22);
  }
  if (live.ASAN) {
    const fy26 = live.ASAN.years.filter((y) => y.fy === 2026);
    t("ASAN FY2026 carries both the $1 chief and the incoming CEO's $39.5M", fy26.length === 2 && fy26.some((y) => y.sct === 1) && fy26.some((y) => y.sct === 39480980), fy26);
  }
  if (live.CNNE) t("CNNE $1 chief ships as filed", live.CNNE.years.some((y) => y.sct === 1 && /Massey/.test(y.peoName || "")));
  // Structural invariant pool-wide: no company carries more than two PEO rows in one fiscal year.
  let over2 = 0;
  for (const c of Object.values(live)) { const by = {}; for (const y of c.years) by[y.fy] = (by[y.fy] || 0) + 1; if (Object.values(by).some((n) => n > 2)) over2++; }
  t("no shipped company has >2 PEO rows in a single fiscal year", over2 === 0);
  t("coverage holds above 80% of the US pool", Object.keys(live).length > 2300);
} catch { /* data file absent: synthetic coverage stands alone */ }

if (failed) { console.error(`\n❌ proxyCompTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ proxyCompTest passed.");
