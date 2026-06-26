#!/usr/bin/env node
// Unit tests for the ADR dividend probe's PURE parsing/verdict logic, run against synthetic XBRL so
// the diagnostic is proven correct without needing SEC access (the live fetch is verified in CI).
//   node scripts/probeAdrDividendsTest.mjs

import assert from "node:assert";
import { companyfactsDividends, parseInlineFacts, parseClassicFacts, parseContexts, verdict } from "./probeAdrDividends.mjs";

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; } };

// ---- inline XBRL: a default-context aggregate plus two dimensioned share-class facts, scale=6 ----
const INLINE = `
<html><body>
  <ix:nonFraction name="ifrs-full:DividendsPaidClassifiedAsFinancingActivities" contextRef="c-default" unitRef="eur" scale="6" decimals="-6" sign="-">2,400</ix:nonFraction>
  <ix:nonFraction name="ifrs-full:DividendsPaid" contextRef="c-classA" unitRef="eur" scale="6" decimals="-6">1,600</ix:nonFraction>
  <ix:nonFraction name="ifrs-full:DividendsPaid" contextRef="c-classB" unitRef="eur" scale="6" decimals="-6">800</ix:nonFraction>
  <ix:nonFraction name="ifrs-full:DividendsPaidPerShare" contextRef="c-default" unitRef="eurPerShare" scale="0" decimals="2">5.80</ix:nonFraction>
  <ix:nonFraction name="us-gaap:Revenues" contextRef="c-default" unitRef="eur" scale="6">28,000</ix:nonFraction>
</body></html>`;
const CONTEXTS = `
  <xbrli:context id="c-default"><xbrli:entity/><xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="c-classA"><xbrli:entity><xbrli:segment><xbrldi:explicitMember dimension="ifrs-full:ClassesOfShareCapitalAxis">asml:OrdinarySharesMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="c-classB"><xbrli:entity><xbrli:segment><xbrldi:explicitMember dimension="ifrs-full:ClassesOfShareCapitalAxis">asml:PreferenceSharesMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period></xbrli:context>`;

t("parseInlineFacts: only dividend facts, scale & sign applied", () => {
  const f = parseInlineFacts(INLINE);
  // Revenues excluded (not a dividend); 4 dividend facts kept (incl. per-share, filtered later).
  assert.equal(f.length, 4, `expected 4 dividend facts, got ${f.length}`);
  const def = f.find((x) => x.ctx === "c-default" && /Financing/.test(x.name));
  assert.equal(def.val, -2_400_000_000, `scale+sign: got ${def.val}`); // 2,400 * 1e6, negated
  const a = f.find((x) => x.ctx === "c-classA");
  assert.equal(a.val, 1_600_000_000, `classA: got ${a.val}`);
});

t("parseContexts: dimensioned detection + member names", () => {
  const m = parseContexts(CONTEXTS);
  assert.equal(m.get("c-default").dimensioned, false);
  assert.equal(m.get("c-classA").dimensioned, true);
  assert.equal(m.get("c-classA").members[0].dim, "ClassesOfShareCapitalAxis");
  assert.equal(m.get("c-classA").members[0].member, "OrdinarySharesMember");
});

t("classic instance facts: namespaced dividend tags parsed", () => {
  const xml = `<xbrl>
    <ifrs-full:DividendsPaid contextRef="c1" unitRef="eur" decimals="-6">2400000000</ifrs-full:DividendsPaid>
    <us-gaap:Revenues contextRef="c1" unitRef="eur">28000000000</us-gaap:Revenues>
  </xbrl>`;
  const f = parseClassicFacts(xml);
  assert.equal(f.length, 1, `only the dividend tag, got ${f.length}`);
  assert.equal(f[0].val, 2_400_000_000);
});

t("companyfactsDividends: annual money coverage, per-share separated", () => {
  const facts = { facts: {
    "us-gaap": {
      "PaymentsOfDividendsCommonStock": { units: { EUR: [
        { start: "2016-01-01", end: "2016-12-31", val: -1.0e9, filed: "2017-02-01" },
        { start: "2017-01-01", end: "2017-12-31", val: -1.1e9, filed: "2018-02-01" },
        { start: "2018-01-01", end: "2018-12-31", val: -1.2e9, filed: "2019-02-01" },
        { start: "2018-07-01", end: "2018-09-30", val: -3.0e8, filed: "2018-10-01" }, // quarter, ignored
      ] } },
      "CommonStockDividendsPerShareDeclared": { units: { "EUR/shares": [
        { start: "2018-01-01", end: "2018-12-31", val: 5.8, filed: "2019-02-01" },
      ] } },
    },
  } };
  const cf = companyfactsDividends(facts, "EUR");
  assert.deepEqual(cf.annualYears, [2016, 2017, 2018], `annual money years: ${cf.annualYears}`);
  const money = cf.found.find((x) => x.isMoney);
  assert.ok(money && !money.perShare, "money tag flagged isMoney, not perShare");
  const ps = cf.found.find((x) => x.perShare);
  assert.ok(ps && !ps.isMoney, "per-share tag flagged perShare, not money");
});

t("verdict: missed-tag when companyfacts richer than pipeline", () => {
  const pipe = { inPool: true, divYrs: [2016, 2017, 2018], ccy: "EUR", std: "IFRS", bbYrs: [], allYrs: [] };
  const cf = { annualYears: [2016, 2017, 2018, 2019, 2020], found: [], moneyTags: [], ccy: "EUR" };
  const v = verdict(pipe, cf, { hasDefault: false, hasDimensioned: false, rows: [] });
  assert.match(v, /missed-tag/, v);
  assert.match(v, /2019,2020/, v);
});

t("verdict: DIMENSIONED-ONLY when companyfacts empty but filing has only dimensioned facts", () => {
  const pipe = { inPool: true, divYrs: [2016, 2017, 2018], ccy: "EUR", std: "IFRS", bbYrs: [], allYrs: [] };
  const cf = { annualYears: [], found: [], moneyTags: [], ccy: "EUR" };
  const gt = { hasDefault: false, hasDimensioned: true, rows: [{ dimensioned: true }] };
  assert.match(verdict(pipe, cf, gt), /DIMENSIONED-ONLY/);
});

t("verdict: filing-default when companyfacts empty but an aggregate exists", () => {
  const pipe = { inPool: true, divYrs: [2016], ccy: "EUR", std: "IFRS", bbYrs: [], allYrs: [] };
  const cf = { annualYears: [], found: [], moneyTags: [], ccy: "EUR" };
  const gt = { hasDefault: true, hasDimensioned: false, rows: [{ dimensioned: false }] };
  assert.match(verdict(pipe, cf, gt), /filing-default/);
});

t("verdict: not-found when absent everywhere", () => {
  const pipe = { inPool: true, divYrs: [], ccy: "EUR", std: "IFRS", bbYrs: [], allYrs: [] };
  const cf = { annualYears: [], found: [], moneyTags: [], ccy: "EUR" };
  const gt = { hasDefault: false, hasDimensioned: false, rows: [] };
  assert.match(verdict(pipe, cf, gt), /not-found/);
});

t("verdict: captured when both agree", () => {
  const pipe = { inPool: true, divYrs: [2016, 2017, 2018], ccy: "EUR", std: "IFRS", bbYrs: [], allYrs: [] };
  const cf = { annualYears: [2016, 2017, 2018], found: [], moneyTags: [], ccy: "EUR" };
  const gt = { hasDefault: true, hasDimensioned: false, rows: [{ dimensioned: false }] };
  assert.match(verdict(pipe, cf, gt), /captured/);
});

// End-to-end on the synthetic ASML-shaped filing: a default aggregate AND dimensioned class facts.
t("integration: inline facts + contexts classify default vs dimensioned", () => {
  const facts = parseInlineFacts(INLINE);
  const ctxs = parseContexts(CONTEXTS);
  const money = facts.filter((f) => !/PerShare/i.test(f.name));
  const def = money.filter((f) => !ctxs.get(f.ctx).dimensioned);
  const dim = money.filter((f) => ctxs.get(f.ctx).dimensioned);
  assert.equal(def.length, 1, "one default aggregate");
  assert.equal(dim.length, 2, "two dimensioned class facts");
});

console.log(`✅ probe ADR dividends: ${pass} checks passed`);
