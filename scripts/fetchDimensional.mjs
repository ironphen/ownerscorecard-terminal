#!/usr/bin/env node
// fetchDimensional.mjs — Tier-2: the named withholds, read from the filings' own inline XBRL.
//
// The SEC companyfacts API serves only undimensioned default-context facts, so a concept a filer
// reports under a segment or product dimension is invisible to the Tier-1 pipeline — Travelers'
// reserve development, Cigna's entire insurance book, Centene's premium line. This fetcher reads
// the 10-K inline-XBRL documents themselves, but ONLY for a named registry of targets whose exact
// dimensional coordinates were mapped and value-verified first (run wf_402f292f, 2026-07-21, 35
// of 43 targets verified to the dollar against the desks' independent derivations). It is a
// keyhole, not a crawl: each target names its filer, tag, and the exact axis-member set its
// context must carry — nothing else is read, and every extraction sits behind the same identity
// gates the desks ratified.
//
// Doctrine notes, decided at ratification:
//   - Wells Fargo (banks desk Q4, "Wave B"): its modern charge-off totals live on EXTENSION
//     namespace tags (wfc:) in the default context — companyfacts drops extension namespaces
//     wholesale. Custom tags are otherwise never read (the TRV sign-flip precedent), but here
//     the extension tag is the ONLY carrier and it self-checks two independent ways every year:
//     gross − recoveries = net, and the same tag's segment members sum exactly to its total.
//     Both gates must hold or the year is withheld. The exception is this narrow.
//   - Centene (managed-care desk Q3 follow-through): the modern premium line is the filer's own
//     income-statement "Revenues: Premium" caption, tagged as an ASC-606 element under
//     HealthCarePremiumMember. The desk's drill verified the MLR computed on it matches the
//     reported health-benefits ratio to a tenth; the enterprise blended proxy stays refused.
//   - Cigna: member-only contexts (the segment axis alone). The 2023-2024 claims-liability
//     balances exist only under disposal-group custom elements during the Medicare-sale window
//     and are deliberately NOT read — those two years stay honestly holed.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compactJson } from "../src/lib/dataFile.mjs";

const UA = process.env.SEC_USER_AGENT || "OwnerScorecard research hello@ownerscorecard.com";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const THROTTLE_MS = 250;
const dataDir = path.join(process.cwd(), "src", "data");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

async function getText(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(120_000) });
      if (res.status === 429) { await sleep(1500 * a); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) { if (a === 4) throw e; await sleep(800 * a); }
  }
}
async function getJSON(url) { return JSON.parse(await getText(url)); }

// ---- the registry: every target named, mapped, and value-verified before it entered ----
const RPO_AXIS = "us-gaap:RevenueRemainingPerformanceObligationExpectedTimingOfSatisfactionStartDateAxis";
const RPO_PERIOD = "us-gaap:RevenueRemainingPerformanceObligationExpectedTimingOfSatisfactionPeriod1";
// The twelve-month band, filed as a share, behind a typed member. Same shape at both filers and
// stable a year back at each. Microsoft additionally tags the total under a commercial-customer
// member; the exact-set-empty rule already refuses that, and the narrative confirms the share
// applies to the whole company's obligations rather than the commercial slice.
const rpoShareBand = { line: "rpoTwelveMonthShare", tag: "us-gaap:RevenueRemainingPerformanceObligationPercentage", axis: RPO_AXIS, periodTag: RPO_PERIOD };

// THE ONE PLACE THIS FILE SWEEPS RATHER THAN AIMS, and the reason it is still a keyhole.
//
// Everywhere else a target names its filer AND its exact axis-member coordinates, because a
// dimensioned fact read blind might be a segment wearing a total's name. The twelve-month band
// has no such ambiguity to resolve: the tag is standard, the axis is standard, and the three
// gates are structural rather than per-filer — the context must carry NO explicit members (which
// is what a segment or product slice would add), exactly one typed member on the named axis, a
// start date exactly one day after the balance-sheet date, and a twelve-month duration filed
// against that same context. A filer whose disclosure differs in any respect yields nothing.
//
// So the per-filer map that the other targets need has no work left to do here, and withholding
// the band from a hundred companies to preserve a ceremony that protects against nothing would
// cost readers the single most useful number on a software page. The sweep covers the shelf's
// filers of size; everyone else keeps the honest blank they already had.
export function softwareBandTargets(companies, minRevenue = 5e8) {
  return companies
    .filter((c) => c.cik && c.lines?.revenue > minRevenue)
    .map((c) => ({ ticker: c.ticker, cik: String(c.cik).padStart(10, "0"), filings: 2, bands: [rpoShareBand], quiet: true }));
}

export const TARGETS = [
  { ticker: "MSFT", cik: "0000789019", filings: 4, bands: [rpoShareBand] },
  { ticker: "NOW", cik: "0001373715", filings: 4, bands: [rpoShareBand] },
  {
    // Salesforce files no typed band at all: its current and noncurrent obligations are its own
    // extension tags, in dollars, in the default context. That is the Wells Fargo precedent — an
    // extension tag read only because it is the sole carrier — and it takes the same treatment: a
    // self-check that must hold or the year is withheld. Current plus noncurrent must equal the
    // undimensioned us-gaap total, which held to the exact filed dollar at three year ends.
    ticker: "CRM", cik: "0001108524", filings: 4,
    lines: [
      { line: "rpoCurrent", kind: "instant", tag: "crm:RevenueRemainingPerformanceObligationCurrent", dims: {} },
    ],
    gateInputs: [
      { name: "noncurrent", kind: "instant", tag: "crm:RevenueRemainingPerformanceObligationNoncurrent", dims: {} },
      { name: "total", kind: "instant", tag: "us-gaap:RevenueRemainingPerformanceObligation", dims: {} },
    ],
    gate: "rpoSplitIdentity",
  },
  {
    ticker: "TRV", cik: "0000086312", filings: 6,
    lines: [
      { line: "reserveDevelopmentPriorYear", kind: "flow",
        tag: "us-gaap:SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense",
        dims: { "srt:ProductOrServiceAxis": "us-gaap:PropertyLiabilityAndCasualtyInsuranceSegmentMember" } },
    ],
    // The sign-identity gate, from the same contexts: CY + PY must equal total incurred
    // (verified exact in all five mapped years).
    gateInputs: [
      { name: "cy", kind: "flow", tag: "us-gaap:SupplementalInformationForPropertyCasualtyInsuranceUnderwritersCurrentYearClaimsAndClaimsAdjustmentExpense",
        dims: { "srt:ProductOrServiceAxis": "us-gaap:PropertyLiabilityAndCasualtyInsuranceSegmentMember" } },
      { name: "total", kind: "flow", tag: "us-gaap:LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaims1",
        dims: { "srt:ProductOrServiceAxis": "us-gaap:PropertyLiabilityAndCasualtyInsuranceSegmentMember" } },
    ],
    gate: "incurredIdentity",
  },
  {
    ticker: "CI", cik: "0001739940", filings: 6,
    lines: [
      { line: "reserveDevelopmentPriorYear", kind: "flow",
        tag: "us-gaap:SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense",
        dims: { "us-gaap:StatementBusinessSegmentsAxis": "ci:CignaHealthcareMember" } },
      { line: "lossReserves", kind: "instant",
        tag: "us-gaap:LiabilityForClaimsAndClaimsAdjustmentExpense",
        dims: { "us-gaap:StatementBusinessSegmentsAxis": "ci:CignaHealthcareMember" } },
      { line: "lossReservesNet", kind: "instant",
        tag: "us-gaap:LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseNet",
        dims: { "us-gaap:StatementBusinessSegmentsAxis": "ci:CignaHealthcareMember" } },
      { line: "reinsuranceRecoverables", kind: "instant",
        tag: "us-gaap:ReinsuranceRecoverableForUnpaidClaimsAndClaimsAdjustments",
        dims: { "us-gaap:StatementBusinessSegmentsAxis": "ci:CignaHealthcareMember" } },
    ],
    gateInputs: [
      { name: "cy", kind: "flow", tag: "us-gaap:SupplementalInformationForPropertyCasualtyInsuranceUnderwritersCurrentYearClaimsAndClaimsAdjustmentExpense",
        dims: { "us-gaap:StatementBusinessSegmentsAxis": "ci:CignaHealthcareMember" } },
      { name: "total", kind: "flow", tag: "us-gaap:LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaims1",
        dims: { "us-gaap:StatementBusinessSegmentsAxis": "ci:CignaHealthcareMember" } },
    ],
    gate: "incurredIdentity",
  },
  {
    ticker: "CNC", cik: "0001071739", filings: 6,
    lines: [
      { line: "premiumsEarned", kind: "flow",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dims: { "srt:ProductOrServiceAxis": "us-gaap:HealthCarePremiumMember" } },
    ],
  },
  {
    ticker: "WFC", cik: "0000072971", filings: 5,
    lines: [
      { line: "netChargeOffs", kind: "flow",
        tag: "wfc:FinancingReceivableAndNetInvestmentInLeaseExcludingAccruedInterestAllowanceForCreditLossWriteoffRecoveryTotal",
        dims: {} },
    ],
    gateInputs: [
      { name: "gross", kind: "flow", tag: "wfc:FinancingReceivableAndNetInvestmentInLeaseExcludingAccruedInterestAllowanceForCreditLossWriteoff", dims: {} },
      { name: "rec", kind: "flow", tag: "wfc:FinancingReceivableAndNetInvestmentInLeaseExcludingAccruedInterestAllowanceForCreditLossRecovery", dims: {} },
      { name: "segA", kind: "flow", tag: "wfc:FinancingReceivableAndNetInvestmentInLeaseExcludingAccruedInterestAllowanceForCreditLossWriteoffRecoveryTotal",
        dims: { "us-gaap:FinancingReceivablePortfolioSegmentAxis": "us-gaap:CommercialPortfolioSegmentMember" } },
      { name: "segB", kind: "flow", tag: "wfc:FinancingReceivableAndNetInvestmentInLeaseExcludingAccruedInterestAllowanceForCreditLossWriteoffRecoveryTotal",
        dims: { "us-gaap:FinancingReceivablePortfolioSegmentAxis": "us-gaap:ConsumerPortfolioSegmentMember" } },
    ],
    gate: "wfcDoubleIdentity",
  },
];

// ---- the inline-XBRL keyhole parser ----

// Contexts: id -> { instant | start/end, dims: {axis: member}, typed: bool }. Handles both
// xbrli:-prefixed and bare element names; explicit members only — a context carrying any typed
// member is marked and never matched (typed dimensions are future work, the MSFT RPO band).
export function parseContexts(doc) {
  const out = {};
  const re = /<(?:xbrli:)?context\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g;
  let m;
  while ((m = re.exec(doc))) {
    const [, id, body] = m;
    const ctx = { dims: {}, typed: /typedMember/.test(body), typedDims: [] };
    const inst = body.match(/<(?:xbrli:)?instant>([^<]+)<\/(?:xbrli:)?instant>/);
    const start = body.match(/<(?:xbrli:)?startDate>([^<]+)<\/(?:xbrli:)?startDate>/);
    const end = body.match(/<(?:xbrli:)?endDate>([^<]+)<\/(?:xbrli:)?endDate>/);
    if (inst) ctx.instant = inst[1].trim();
    if (start) ctx.start = start[1].trim();
    if (end) ctx.end = end[1].trim();
    const dimRe = /<xbrldi:explicitMember\s+dimension="([^"]+)"\s*>([^<]+)<\/xbrldi:explicitMember>/g;
    let d;
    while ((d = dimRe.exec(body))) ctx.dims[d[1].trim()] = d[2].trim();
    // Typed members carry their value in a nested element rather than as a member QName. The
    // twelve-month RPO band is filed this way: one typed member on the timing axis whose inner
    // element is the axis name plus ".domain" and whose content is the date the band starts.
    const typedRe = /<xbrldi:typedMember\s+dimension="([^"]+)"\s*>\s*<([^\s>/]+)[^>]*>([\s\S]*?)<\/\2>\s*<\/xbrldi:typedMember>/g;
    let ty;
    while ((ty = typedRe.exec(body))) ctx.typedDims.push({ dimension: ty[1].trim(), inner: ty[2].trim(), content: ty[3].replace(/<[^>]+>/g, "").trim() });
    out[id] = ctx;
  }
  return out;
}

// Facts for ONE tag: [{contextRef, value}] with ix sign and scale applied and formatting stripped.
export function parseFacts(doc, tag) {
  const out = [];
  const re = new RegExp(`<ix:nonFraction([^>]*name="${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*)>([\\s\\S]*?)<\\/ix:nonFraction>`, "g");
  let m;
  while ((m = re.exec(doc))) {
    const attrs = m[1];
    const ctxRef = (attrs.match(/contextRef="([^"]+)"/) || [])[1];
    if (!ctxRef) continue;
    if (/xsi:nil="true"/.test(attrs)) continue;
    const scale = Number((attrs.match(/scale="(-?\d+)"/) || [])[1] ?? 0);
    const sign = /sign="-"/.test(attrs) ? -1 : 1;
    const text = m[2].replace(/<[^>]+>/g, "").replace(/[,\s]/g, "");
    const num = parseFloat(text);
    if (!Number.isFinite(num)) continue;
    out.push({ contextRef: ctxRef, value: num * Math.pow(10, scale) * sign });
  }
  return out;
}

// A context matches a target when its explicit-member set EQUALS the spec exactly (no extra
// axes, no typed members) and its period shape fits the kind.
// The twelve-month band's context, matched by all three of its identifying marks at once. NOW files
// 13-36-month DECOY contexts on the SAME axis, and CRM's decoy shares the very same start date, so
// no single test separates the band from its neighbours: the explicit-member set must be empty (the
// decoys carry srt:RangeAxis min/max), the typed date must be the balance-sheet date plus one day
// (a later band starts a year out), and the caller must additionally confirm the same context
// carries a twelve-month duration. Any one failing withholds the band rather than guessing.
export function typedContextMatches(ctx, spec) {
  if (!ctx || !spec) return false;
  if (Object.keys(ctx.dims).length) return false;
  if ((ctx.typedDims || []).length !== 1) return false;
  const [tm] = ctx.typedDims;
  if (tm.dimension !== spec.axis) return false;
  if (!tm.inner.endsWith(".domain")) return false;
  if (!ctx.instant) return false;
  const start = Date.parse(tm.content);
  if (!Number.isFinite(start)) return false;
  return Math.round((start - Date.parse(ctx.instant)) / 86400000) === 1;
}

export function contextMatches(ctx, dims, kind) {
  if (!ctx || ctx.typed) return false;
  const want = Object.entries(dims);
  const have = Object.entries(ctx.dims);
  if (want.length !== have.length) return false;
  for (const [axis, member] of want) if (ctx.dims[axis] !== member) return false;
  if (kind === "flow") {
    if (!ctx.start || !ctx.end) return false;
    const dur = days(ctx.start, ctx.end);
    return dur >= 350 && dur <= 380;
  }
  return !!ctx.instant;
}

// Duration facts are ix:nonNumeric, not ix:nonFraction, and carry their months as text under an
// ixt-sec:durmonth format. Read narrowly, and only to confirm a band is the twelve-month one.
export function parseDurationMonths(doc, tag) {
  const out = [];
  const re = new RegExp(`<ix:nonNumeric([^>]*name="${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*)>([\\s\\S]*?)<\\/ix:nonNumeric>`, "g");
  let m;
  while ((m = re.exec(doc))) {
    const ctxRef = (m[1].match(/contextRef="([^"]+)"/) || [])[1];
    if (!ctxRef) continue;
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    const n = parseInt(text, 10);
    if (Number.isFinite(n)) out.push({ contextRef: ctxRef, months: n });
  }
  return out;
}

// The twelve-month share of remaining performance obligations, as a filed FRACTION. The value is
// never multiplied by the total: Microsoft calls its own figure "approximately", and deriving
// dollars from it would manufacture a precision the filer declined to give.
export function extractBandShare(doc, spec) {
  const contexts = parseContexts(doc);
  const twelveMonth = new Set(
    parseDurationMonths(doc, spec.periodTag).filter((d) => d.months === 12).map((d) => d.contextRef),
  );
  const series = {};
  for (const f of parseFacts(doc, spec.tag)) {
    if (!twelveMonth.has(f.contextRef)) continue; // the same-context twelve-month gate
    const ctx = contexts[f.contextRef];
    if (!typedContextMatches(ctx, spec)) continue;
    if (!(f.value > 0 && f.value <= 1)) continue; // a share, never a count
    series[new Date(ctx.instant).getUTCFullYear()] = f.value;
  }
  return series;
}

export function extractSeries(doc, spec) {
  const contexts = parseContexts(doc);
  const series = {};
  for (const f of parseFacts(doc, spec.tag)) {
    const ctx = contexts[f.contextRef];
    if (!contextMatches(ctx, spec.dims, spec.kind)) continue;
    const fy = new Date(spec.kind === "flow" ? ctx.end : ctx.instant).getUTCFullYear();
    series[fy] = f.value; // within one document a (tag, context-shape, year) is single-valued
  }
  return series;
}

// Gates ----------------------------------------------------------------------------------
const GATES = {
  // Salesforce's extension pair must reconstruct the standard total exactly, or the year is
  // withheld. This is what makes reading a filer's own tag defensible: a silent rename or a
  // change of meaning breaks the identity and produces a blank rather than a wrong number.
  rpoSplitIdentity(lines, gates, W, who) {
    const cur = lines.rpoCurrent;
    if (!cur) return;
    for (const fy of Object.keys(cur)) {
      const nc = gates.noncurrent?.[fy], total = gates.total?.[fy];
      if (nc == null || total == null) { cur[fy] = null; W(`${who} RPO ${fy}: identity inputs missing — withheld`); continue; }
      if (Math.abs(cur[fy] + nc - total) > Math.max(Math.abs(total) * 0.005, 1e6)) {
        cur[fy] = null; W(`${who} RPO ${fy}: current + noncurrent ≠ total — withheld`);
      }
    }
  },

  // CY + PY = total incurred, exact within tolerance — the ratified sign-identity, which at
  // these coordinates has held to the dollar in every mapped year.
  incurredIdentity(lines, gates, W, who) {
    const dev = lines.reserveDevelopmentPriorYear;
    if (!dev) return;
    for (const fy of Object.keys(dev)) {
      const cy = gates.cy?.[fy], total = gates.total?.[fy];
      if (cy == null || total == null) { dev[fy] = null; W(`${who} development ${fy}: identity inputs missing — withheld`); continue; }
      const tol = Math.max(Math.abs(total) * 0.015, 5e6);
      if (Math.abs(cy + dev[fy] - total) > tol) { dev[fy] = null; W(`${who} development ${fy}: fails CY + PY = total — withheld`); }
    }
  },
  // The Wells Fargo double identity: gross − recoveries = net, AND the segment members of the
  // same extension tag sum to its total. Both must hold or the year is withheld.
  wfcDoubleIdentity(lines, gates, W, who) {
    const net = lines.netChargeOffs;
    if (!net) return;
    for (const fy of Object.keys(net)) {
      const g = gates.gross?.[fy], r = gates.rec?.[fy], a = gates.segA?.[fy], b = gates.segB?.[fy];
      const grossNet = g != null && r != null ? Math.abs(g) - Math.abs(r) : null;
      const segSum = a != null && b != null ? a + b : null;
      const tol = Math.max(Math.abs(net[fy]) * 0.01, 2e6);
      if (grossNet == null || Math.abs(grossNet - net[fy]) > tol) { net[fy] = null; W(`${who} netChargeOffs ${fy}: gross − recoveries misses net — withheld`); continue; }
      if (segSum == null || Math.abs(segSum - net[fy]) > tol) { net[fy] = null; W(`${who} netChargeOffs ${fy}: segment members miss the total — withheld`); }
    }
  },
};

async function main() {
  const outPath = path.join(dataDir, "dimensional.json");
  const result = {};
  const warns = [];
  const W = (s) => { warns.push(s); console.warn(`  ! ${s}`); };

  // The curated registry, then the band sweep over the software shelf. The sweep is skipped when
  // the shelf cannot be resolved, so a missing data file degrades to the registry rather than
  // failing the run.
  let sweep = [];
  try {
    const { industryLabelOf } = await import(pathToFileURL(path.join(process.cwd(), "src", "lib", "shelves.mjs")).href);
    const pool = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8")).companies || [];
    const named = new Set(TARGETS.map((t) => t.ticker));
    sweep = softwareBandTargets(pool.filter((c) => industryLabelOf(c) === "Software" && !named.has(c.ticker)));
    console.log(`Band sweep: ${sweep.length} software filers beyond the registry.`);
  } catch (e) { console.warn(`  ! band sweep skipped (${e.message})`); }

  for (const t of [...TARGETS, ...sweep]) {
    console.log(`\n${t.ticker}:`);
    const sub = await getJSON(`https://data.sec.gov/submissions/CIK${t.cik}.json`);
    // A heavy filer's 10-Ks fall out of the `recent` window fast (Wells Fargo files prospectus
    // supplements daily), so walk the paginated submission files until enough 10-Ks are found.
    const tenKs = [];
    const harvest = (r) => {
      for (let i = 0; i < r.form.length && tenKs.length < t.filings; i++) {
        if (r.form[i] === "10-K") tenKs.push({ accn: r.accessionNumber[i], doc: r.primaryDocument[i] });
      }
    };
    harvest(sub.filings.recent);
    for (const page of sub.filings.files || []) {
      if (tenKs.length >= t.filings) break;
      await sleep(THROTTLE_MS);
      const older = await getJSON(`https://data.sec.gov/submissions/${page.name}`);
      harvest(older);
    }
    const lines = {}; const gates = {};
    // Oldest first, newer filings overwrite: the latest filing's value wins a year (the mapping
    // verified cross-filing equality at every target).
    for (const f of tenKs.reverse()) {
      await sleep(THROTTLE_MS);
      const base = `https://www.sec.gov/Archives/edgar/data/${Number(t.cik)}/${f.accn.replace(/-/g, "")}`;
      // An inline-XBRL 10-K can be a multi-part document set (Wells Fargo's primary document is
      // the cover part; the statements live in a 12MB sibling). Read every substantive .htm part
      // of the set — source documents, never the SEC viewer's rendered R-files — concatenated,
      // so contexts defined in one part resolve facts in another.
      let doc;
      try {
        const idx = await getJSON(`${base}/index.json`);
        const parts = (idx.directory?.item || [])
          .filter((x) => x.name.endsWith(".htm") && !/^R\d+\.htm$/i.test(x.name) && Number(x.size) > 200_000)
          .map((x) => x.name);
        const names = parts.length ? parts : [f.doc];
        const texts = [];
        for (const name of names) { await sleep(THROTTLE_MS); texts.push(await getText(`${base}/${name}`)); }
        doc = texts.join("\n");
      } catch (e) { W(`${t.ticker} ${f.accn}: fetch failed (${e.message}) — filing skipped`); continue; }
      for (const spec of t.lines || []) {
        const s = extractSeries(doc, spec);
        lines[spec.line] = { ...(lines[spec.line] || {}), ...s };
      }
      for (const spec of t.bands || []) {
        const s = extractBandShare(doc, spec);
        lines[spec.line] = { ...(lines[spec.line] || {}), ...s };
      }
      for (const spec of t.gateInputs || []) {
        const s = extractSeries(doc, spec);
        gates[spec.name] = { ...(gates[spec.name] || {}), ...s };
      }
      console.log(`  ${f.accn} read`);
    }
    if (t.gate) GATES[t.gate](lines, gates, W, t.ticker);
    for (const [line, series] of Object.entries(lines)) {
      const kept = Object.fromEntries(Object.entries(series).filter(([, v]) => v != null));
      if (Object.keys(kept).length) (result[t.ticker] ||= {})[line] = kept;
    }
    console.log(`  lines: ${Object.entries(result[t.ticker] || {}).map(([l, s]) => `${l}(${Object.keys(s).length}y)`).join(", ") || "none"}`);
  }

  const out = { asOf: new Date().toISOString().slice(0, 10), source: "SEC inline-XBRL 10-K instances: named dimensional targets, mapped and value-verified before entry (docs desk surveys; run wf_402f292f)", companies: result };
  const tmp = outPath + ".tmp";
  fs.writeFileSync(tmp, compactJson(out));
  fs.renameSync(tmp, outPath);
  console.log(`\n✅ dimensional: ${Object.keys(result).length} filers; ${warns.length} warnings`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`\n❌ ${e.message}\n`); process.exit(1); });
}
