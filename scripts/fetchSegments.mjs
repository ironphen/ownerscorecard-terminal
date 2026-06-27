#!/usr/bin/env node
// fetchSegments.mjs — "where the money comes from."
//
// Reportable-segment and geographic revenue (plus segment operating income, when a
// company discloses it) pulled from each 10-K's XBRL instance on EDGAR. This is the
// only free primary source that carries the breakdown: the companyfacts API we use
// for fundamentals returns consolidated totals only and strips the dimensions.
//
// Safety first, because wrong data is worse than none. We keep only facts with a
// single dimension on the target axis (no cross-tab double counting), keep the
// company's own reportable segments and drop the us-gaap roll-up members, and
// reconcile every breakdown against the consolidated revenue we already hold. If a
// breakdown doesn't sum to within a sane band of the total, we emit nothing for it.
//
//   npm run fetch:segments
//   ONLY_TICKERS=AMZN,AAPL npm run fetch:segments   (audit a subset)

import fs from "node:fs";
import { compactJson } from "../src/lib/dataFile.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const UA = process.env.SEC_USER_AGENT || "Owner Scorecard research (ryanreinsant@gmail.com)";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const dataDir = path.join(process.cwd(), "src", "data");
const fundamentals = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ONLY = (process.env.ONLY_TICKERS || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const DEBUG = (process.env.SEG_DEBUG || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

// ---- fetch with retry/backoff, EDGAR is polite-rate only ----
async function fetchText(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      // 60s per-attempt timeout so a hung server can't freeze the run; an abort retries like any failure.
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429) { await sleep(1000 * a); continue; }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) { if (a === 4) throw e; await sleep(500 * a); }
  }
}

// ---- XBRL taxonomy: the concepts and axes we read ----
const REV_TAGS = [
  "Revenue", "RevenueFromContractsWithCustomers",           // IFRS
  "RevenueFromContractWithCustomerExcludingAssessedTax",    // US-GAAP (ASC 606)
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "Revenues",
];
const OI_TAGS = ["OperatingIncomeLoss", "ProfitLossFromOperatingActivities"]; // US-GAAP, IFRS
// Segment / geographic / product axes across taxonomies. US-GAAP uses fixed axis names; IFRS has no
// standard segment axis, so filers coin their own — but the ADR-pool probe showed they cluster on a
// handful (SegmentsAxis, ProductsAndServicesAxis, GeographicalAreasAxis). For each bucket the richest
// axis that reconciles to consolidated revenue wins; reconciliation is the safety net, so an unrelated
// axis that merely matches a name (a markets-of-customers or legal-entity split that sums past 100%)
// can't slip through.
const SEG_AXES = ["StatementBusinessSegmentsAxis", "SegmentsAxis", "OperatingSegmentsAxis", "BusinessSegmentsAxis", "ReportableSegmentsAxis"];
const GEO_AXES = ["StatementGeographicalAxis", "GeographicalAreasAxis"];
const PROD_AXES = ["ProductOrServiceAxis", "ProductsAndServicesAxis"];

// Standard XBRL namespaces, used to tell a company's own segment member from the
// us-gaap roll-up members (OperatingSegmentsMember and friends) that would double count.
const STD_PREFIX = new Set(["us-gaap", "srt", "dei", "country", "stpr", "exch", "currency", "naics", "sic", "xbrli", "iso4217"]);
// Aggregate / reconciling members to exclude from any axis (they are subtotals, not
// parts). Includes the us-gaap ASU 2023-07 roll-up (ReportableSegmentAggregationBefore-
// OtherOperatingSegment), the sum of reportable segments before the residual bucket,
// which otherwise leads a breakdown at ~100% with a meaningless label (Chevron, FAST).
const AGGREGATE = /^(OperatingSegments|ReportableSegments?|ReportableSegmentAggregationBeforeOtherOperatingSegment|ReportableGeographicalSegments?|IntersegmentEliminations?|ConsolidationEliminations?|MaterialReconcilingItems|SegmentReconcilingItems|CorporateNonSegment|ProductsAndServices)Member$/i;

const local = (qn) => (qn || "").split(":").pop();
const prefixOf = (qn) => ((qn || "").includes(":") ? qn.split(":")[0] : "");
const isCompanyMember = (qn) => { const p = prefixOf(qn); return p && !STD_PREFIX.has(p); };
const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

// ---- parse the instance: contexts (period + dimensions) and facts ----
function parseContexts(xml, periodEnd) {
  const out = new Map();
  const ctxRe = /<(?:[\w.-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?context>/g;
  let m;
  while ((m = ctxRe.exec(xml))) {
    const id = m[1], block = m[2];
    const start = (block.match(/<(?:[\w.-]+:)?startDate>\s*([\d-]+)\s*</) || [])[1] || null;
    const end = (block.match(/<(?:[\w.-]+:)?endDate>\s*([\d-]+)\s*</) || [])[1] || null;
    const dims = [];
    const memRe = /<(?:[\w.-]+:)?explicitMember\b[^>]*\bdimension="([^"]+)"[^>]*>\s*([^<\s][^<]*?)\s*<\/(?:[\w.-]+:)?explicitMember>/g;
    let d;
    while ((d = memRe.exec(block))) dims.push({ axisLocal: local(d[1]), member: d[2].trim(), memberLocal: local(d[2].trim()) });
    // current full fiscal year: a ~annual duration ending on the filing's period end.
    const current = !!(start && end && days(end, periodEnd) <= 5 && days(start, end) >= 350 && days(start, end) <= 380);
    out.set(id, { dims, current });
  }
  return out;
}

function parseFacts(xml, tag) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*\\bcontextRef="([^"]+)"[^>]*>\\s*(-?[0-9][0-9.]*)\\s*<`, "g");
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push({ ctx: m[1], val: parseFloat(m[2]) });
  return out;
}

// Single-dimension members on one axis, current year only, aggregates removed.
function membersOnAxis(facts, contexts, axisLocal, companyOnly) {
  const out = new Map();
  for (const f of facts) {
    const c = contexts.get(f.ctx);
    if (!c || !c.current || c.dims.length !== 1) continue;
    const dim = c.dims[0];
    if (dim.axisLocal !== axisLocal) continue;
    if (AGGREGATE.test(dim.memberLocal)) continue;
    if (companyOnly && !isCompanyMember(dim.member)) continue;
    if (!out.has(dim.member)) out.set(dim.member, { member: dim.member, memberLocal: dim.memberLocal, value: f.val });
  }
  return out;
}

// Of the candidate revenue concepts, use whichever yields the richest breakdown.
function bestRevenue(xml, contexts, axisLocal, companyOnly) {
  let best = new Map();
  for (const tag of REV_TAGS) {
    const m = membersOnAxis(parseFacts(xml, tag), contexts, axisLocal, companyOnly);
    if (m.size > best.size) best = m;
  }
  return best;
}

// The best reconciling breakdown across a list of candidate axis names: each axis tried, subtotals
// stripped, and the richest one that reconciles to consolidated revenue wins — so a 2-member geographic
// split never beats a full reportable-segment one, and an axis that doesn't reconcile is dropped.
function bestAxis(xml, contexts, axisNames, total) {
  let best = null;
  for (const ax of axisNames) {
    const map = stripSubtotals(bestRevenue(xml, contexts, ax, false), total);
    const r = reconcile(map, total);
    if (r && (!best || map.size > best.map.size)) best = { map, axis: ax, ratio: r };
  }
  return best;
}

// Filers often tag the same axis at two granularities at once: Apple's "Products"
// ($307B) alongside iPhone/Mac/iPad/Wearables that compose it, or Nvidia's "Data
// Center" alongside Compute + Networking. Summed naively that double counts. A
// roll-up is exactly the member whose value equals the overshoot above the total,
// so we can find and drop it precisely, then re-check.
function stripSubtotals(map, total) {
  if (!total || map.size < 2) return map;
  let entries = [...map.values()];
  for (let guard = 0; guard < 6; guard++) {
    const sum = entries.reduce((a, b) => a + b.value, 0);
    if (sum <= total * 1.1) break;
    const diff = sum - total;
    let idx = -1, best = Infinity;
    entries.forEach((e, i) => { const d = Math.abs(e.value - diff); if (d < best) { best = d; idx = i; } });
    if (idx < 0 || best > total * 0.05) break; // no member cleanly equal to the overshoot; leave it for reconcile to reject
    entries.splice(idx, 1);
  }
  return new Map(entries.map((e) => [e.member, e]));
}

// ---- labels: MetaLinks.json carries the human label for every member ----
// MetaLinks keys its tags with underscores (aapl_IPhoneMember), not the colon form
// used inside the instance, so we index every label under both forms and the bare
// local name to be sure the member resolves.
function buildLabels(meta) {
  const map = {};
  try {
    const insts = meta?.instance ? Object.values(meta.instance) : [];
    for (const inst of insts) {
      const tags = inst?.tag || {};
      for (const [rawKey, t] of Object.entries(tags)) {
        const langs = t?.lang;
        if (!langs || typeof langs !== "object") continue;
        const en = langs["en-US"] || langs["en-us"] || Object.values(langs)[0];
        const role = en?.role;
        if (!role || typeof role !== "object") continue;
        let cands = [];
        for (const [k, v] of Object.entries(role)) { if (typeof v === "string" && !/documentation/i.test(k)) cands.push(v); }
        cands = cands.map((s) => s.replace(/\s*\[member\]\s*$/i, "").trim()).filter(Boolean);
        if (!cands.length) continue;
        cands.sort((a, b) => a.length - b.length);
        const label = cands[0];
        map[rawKey] = label;
        map[rawKey.replace("_", ":")] = label;
        const localK = rawKey.split(/[:_]/).pop();
        if (!(localK in map)) map[localK] = label;
      }
    }
  } catch {}
  return map;
}
function prettify(localName) {
  return localName
    .replace(/Member$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\bI (Phone|Pad|Pod|Mac|Cloud|Tunes|Watch|OS|Message)\b/g, "i$1") // I Phone -> iPhone
    .trim();
}
// ISO country codes (country:US) to country names, plus the standard region and
// product members whose filed label is just a code or an abbreviation.
const REGION = (() => { try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return null; } })();
const STD_LABELS = {
  "us-gaap:NonUsMember": "International", "us-gaap:ProductMember": "Products", "us-gaap:ServiceMember": "Services",
  "us-gaap:EMEAMember": "EMEA", "us-gaap:AsiaPacificMember": "Asia Pacific",
  "srt:AmericasMember": "Americas", "srt:NorthAmericaMember": "North America", "srt:SouthAmericaMember": "South America",
  "srt:LatinAmericaMember": "Latin America", "srt:EuropeMember": "Europe", "srt:AsiaPacificMember": "Asia Pacific",
  "srt:AsiaMember": "Asia", "srt:EuropeanUnionMember": "European Union", "srt:MiddleEastMember": "Middle East", "srt:AfricaMember": "Africa",
};
function labelFor(qn, localName, labels) {
  if (/^country:/.test(qn) && REGION) { const code = qn.split(":")[1]; try { const n = REGION.of(code); if (n && n !== code) return n; } catch {} }
  if (STD_LABELS[qn]) return STD_LABELS[qn];
  const meta = labels[qn] || labels[qn.replace(":", "_")] || labels[localName];
  if (meta) return meta;
  return prettify(localName);
}

// ---- reconcile a breakdown against the consolidated figure ----
function reconcile(map, total, lo = 0.8, hi = 1.1) {
  if (!total || map.size < 2) return null;
  const sum = [...map.values()].reduce((a, b) => a + b.value, 0);
  const ratio = sum / total;
  return ratio >= lo && ratio <= hi ? ratio : null;
}

function itemsFrom(map, labels, oiMap) {
  return [...map.values()]
    .map((v) => ({
      label: labelFor(v.member, v.memberLocal, labels),
      qname: v.member,
      revenue: v.value,
      operatingIncome: oiMap && oiMap.has(v.member) ? oiMap.get(v.member).value : null,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

async function instanceUrls(sourceUrl) {
  // The instance and MetaLinks sit beside the primary 10-K document.
  const folder = sourceUrl.slice(0, sourceUrl.lastIndexOf("/") + 1);
  let instUrl = sourceUrl.replace(/\.htm[l]?$/i, "_htm.xml");
  // Confirm/repair via the folder index if the derived name is wrong (older layouts).
  return { folder, instUrl };
}

async function forCompany(c) {
  if (!c.sourceUrl || !c.periodEnd) return null;
  const total = c.lines?.revenue ?? null;
  const oiTotal = c.lines?.operatingIncome ?? null;
  const { folder, instUrl } = await instanceUrls(c.sourceUrl);

  let xml = await fetchText(instUrl);
  if (!xml) {
    // Fallback: read the folder index and find the instance (.xml that isn't a linkbase/schema).
    try {
      const idx = JSON.parse((await fetchText(folder + "index.json")) || "{}");
      const names = (idx.directory?.item || []).map((i) => i.name);
      const cand = names.find((n) => /_htm\.xml$/i.test(n)) ||
        names.find((n) => /\.xml$/i.test(n) && !/_(cal|def|lab|pre)\.xml$/i.test(n) && !/\.xsd$/i.test(n));
      if (cand) xml = await fetchText(folder + cand);
    } catch {}
  }
  if (!xml) return null;

  const meta = await (async () => { try { return JSON.parse((await fetchText(folder + "MetaLinks.json")) || "{}"); } catch { return {}; } })();
  const labels = buildLabels(meta);
  const contexts = parseContexts(xml, c.periodEnd);

  if (DEBUG.includes(String(c.ticker).toUpperCase())) {
    const axes = {};
    for (const tag of [...new Set([...REV_TAGS, OI_TAGS[0]])]) {
      for (const f of parseFacts(xml, tag)) {
        const cx = contexts.get(f.ctx);
        if (!cx || !cx.current || cx.dims.length !== 1) continue;
        const ax = cx.dims[0].axisLocal;
        (axes[ax] ||= new Set()).add(`${cx.dims[0].member}=${(f.val / 1e9).toFixed(1)}B`);
      }
    }
    console.log(`\n=== ${c.ticker} (total rev ${(total / 1e9).toFixed(1)}B) single-dim current-year axes ===`);
    for (const [ax, ms] of Object.entries(axes)) console.log(`  ${ax}: ${[...ms].join(", ")}`);
    const lk = Object.keys(labels);
    console.log(`  labels resolved: ${lk.length}; sample: ${lk.slice(0, 5).map((k) => `${k}=${labels[k]}`).join(" | ")}`);
    console.log("");
  }

  return buildRecord(xml, contexts, labels, { fy: c.fy, periodEnd: c.periodEnd, sourceUrl: c.sourceUrl, total, oiTotal });
}

// Extract the three breakdowns from a parsed instance — shared by the US (10-K) and ADR (20-F) fetchers,
// since both are EDGAR XBRL once the instance and labels are in hand. We keep every member on each axis
// except the named roll-up subtotals (handled by AGGREGATE), because some filers report segments with
// standard geographic members rather than company-defined ones; reconciliation is the real safety net.
function buildRecord(xml, contexts, labels, { fy, periodEnd, sourceUrl, total, oiTotal }) {
  if (!total) return null;
  const seg = bestAxis(xml, contexts, SEG_AXES, total);
  const geo = bestAxis(xml, contexts, GEO_AXES, total);
  const prod = bestAxis(xml, contexts, PROD_AXES, total);
  const out = { fy, periodEnd, sourceUrl, revenueTotal: total, operatingIncomeTotal: oiTotal };
  let any = false;

  if (seg) {
    // Trust the OI split only if it covers most segments and isn't wildly off the consolidated.
    const oiFacts = OI_TAGS.flatMap((t) => parseFacts(xml, t));
    const segOI = membersOnAxis(oiFacts, contexts, seg.axis, false);
    const oiSum = [...segOI.values()].reduce((a, b) => a + Math.abs(b.value), 0);
    const oiOk = segOI.size >= Math.ceil(seg.map.size / 2) && oiTotal != null && oiSum > 0 && oiSum <= Math.abs(oiTotal) * 3;
    out.bySegment = { reconcile: +seg.ratio.toFixed(3), hasOperatingIncome: !!oiOk, items: itemsFrom(seg.map, labels, oiOk ? segOI : null) };
    any = true;
  }
  if (geo) { out.byGeography = { reconcile: +geo.ratio.toFixed(3), items: itemsFrom(geo.map, labels, null) }; any = true; }
  if (prod) { out.byProduct = { reconcile: +prod.ratio.toFixed(3), items: itemsFrom(prod.map, labels, null) }; any = true; }
  return any ? out : null;
}

async function main() {
  const companies = (fundamentals.companies || []).filter((c) => !ONLY.length || ONLY.includes(String(c.ticker).toUpperCase()));
  const result = {};
  let hit = 0;
  for (const c of companies) {
    await sleep(200);
    let r = null;
    try { r = await forCompany(c); } catch (e) { console.warn(`  ! ${c.ticker}: ${e.message}`); continue; }
    if (!r) { console.log(`${c.ticker}: —`); continue; }
    result[c.ticker] = r;
    hit++;
    const seg = r.bySegment ? `seg ${r.bySegment.items.length}${r.bySegment.hasOperatingIncome ? "+OI" : ""} (×${r.bySegment.reconcile})` : "seg —";
    const geo = r.byGeography ? `geo ${r.byGeography.items.length} (×${r.byGeography.reconcile})` : "geo —";
    const prod = r.byProduct ? `prod ${r.byProduct.items.length} (×${r.byProduct.reconcile})` : "prod —";
    console.log(`${c.ticker}: ${seg} | ${geo} | ${prod}`);
  }

  const outPath = path.join(dataDir, "segments.json");
  // Preserve companies we didn't process this run (subset/audit runs) so we never wipe data.
  let prior = {};
  try { prior = JSON.parse(fs.readFileSync(outPath, "utf8")).companies || {}; } catch {}
  // Preserve entries from the OTHER pool (ADR writes its breakdowns into this same file), keyed by
  // ticker: a full US run replaces only US tickers, never the ADR breakdowns.
  const universe = new Set((fundamentals.companies || []).map((c) => String(c.ticker).toUpperCase()));
  const otherPool = Object.fromEntries(Object.entries(prior).filter(([t]) => !universe.has(t.toUpperCase())));
  const merged = ONLY.length ? { ...prior, ...result } : { ...otherPool, ...result };
  const out = { asOf: new Date().toISOString().slice(0, 10), source: "SEC EDGAR XBRL, reportable-segment and geographic disclosures", companies: merged };
  fs.writeFileSync(outPath, compactJson(out));
  console.log(`\n✅ Segments: ${hit}/${companies.length} companies with a usable breakdown (${Object.keys(merged).length} total in file)`);
}

export { parseContexts, parseFacts, membersOnAxis, reconcile, prettify, AGGREGATE, isCompanyMember, buildRecord, buildLabels };

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
