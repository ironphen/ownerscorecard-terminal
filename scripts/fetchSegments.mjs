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
import path from "node:path";
import { pathToFileURL } from "node:url";

const UA = process.env.SEC_USER_AGENT || "Owner Scorecard research (ryanreinsant@gmail.com)";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const dataDir = path.join(process.cwd(), "src", "data");
const fundamentals = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ONLY = (process.env.ONLY_TICKERS || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

// ---- fetch with retry/backoff, EDGAR is polite-rate only ----
async function fetchText(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429) { await sleep(1000 * a); continue; }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) { if (a === 4) throw e; await sleep(500 * a); }
  }
}

// ---- XBRL taxonomy: the concepts and axes we read ----
const REV_TAGS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTaxMember", // never a tag; guard noop
];
const OI_TAGS = ["OperatingIncomeLoss"];
const SEG_AXIS = "StatementBusinessSegmentsAxis";
const GEO_AXIS = "StatementGeographicalAxis";
const PROD_AXIS = "ProductOrServiceAxis";

// Standard XBRL namespaces, used to tell a company's own segment member from the
// us-gaap roll-up members (OperatingSegmentsMember and friends) that would double count.
const STD_PREFIX = new Set(["us-gaap", "srt", "dei", "country", "stpr", "exch", "currency", "naics", "sic", "xbrli", "iso4217"]);
// Aggregate / reconciling members to exclude from any axis (they are subtotals, not parts).
const AGGREGATE = /^(OperatingSegments|ReportableSegments?|ReportableGeographicalSegments?|IntersegmentEliminations?|ConsolidationEliminations?|MaterialReconcilingItems|SegmentReconcilingItems|CorporateNonSegment|ProductsAndServices)Member$/i;

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

// ---- labels: MetaLinks.json carries the human label for every member ----
function buildLabels(meta) {
  const map = {};
  try {
    const inst = meta?.instance && Object.values(meta.instance)[0];
    const tags = inst?.tag || {};
    for (const [qn, t] of Object.entries(tags)) {
      const role = t?.lang?.["en-US"]?.role;
      if (!role || typeof role !== "object") continue;
      let cands = [];
      for (const [k, v] of Object.entries(role)) { if (typeof v === "string" && !/documentation/i.test(k)) cands.push(v); }
      cands = cands.map((s) => s.replace(/\s*\[member\]\s*$/i, "").trim()).filter(Boolean);
      if (cands.length) { cands.sort((a, b) => a.length - b.length); map[qn] = cands[0]; }
    }
  } catch {}
  return map;
}
function prettify(localName) {
  return localName.replace(/Member$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").trim();
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
  if (labels[qn]) return labels[qn];
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

  // Segment revenue and segment operating income. We keep every member on the
  // segment axis except the named us-gaap roll-up subtotals (handled by AGGREGATE),
  // because some filers (Apple) report their segments with standard srt geographic
  // members rather than company-defined ones. Reconciliation is the real safety net.
  const segRev = bestRevenue(xml, contexts, SEG_AXIS, false);
  const segOI = membersOnAxis(parseFacts(xml, OI_TAGS[0]), contexts, SEG_AXIS, false);
  const geoRev = bestRevenue(xml, contexts, GEO_AXIS, false);
  const prodRev = bestRevenue(xml, contexts, PROD_AXIS, false);

  const out = { fy: c.fy, periodEnd: c.periodEnd, sourceUrl: c.sourceUrl, revenueTotal: total, operatingIncomeTotal: oiTotal };
  let any = false;

  const segR = reconcile(segRev, total);
  if (segR) {
    // Trust the OI split only if it covers most segments and isn't wildly off the consolidated.
    const oiSum = [...segOI.values()].reduce((a, b) => a + Math.abs(b.value), 0);
    const oiOk = segOI.size >= Math.ceil(segRev.size / 2) && oiTotal != null && oiSum > 0 && oiSum <= Math.abs(oiTotal) * 3;
    out.bySegment = { reconcile: +segR.toFixed(3), hasOperatingIncome: !!oiOk, items: itemsFrom(segRev, labels, oiOk ? segOI : null) };
    any = true;
  }
  const geoR = reconcile(geoRev, total);
  if (geoR) { out.byGeography = { reconcile: +geoR.toFixed(3), items: itemsFrom(geoRev, labels, null) }; any = true; }
  const prodR = reconcile(prodRev, total);
  if (prodR) { out.byProduct = { reconcile: +prodR.toFixed(3), items: itemsFrom(prodRev, labels, null) }; any = true; }

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
  const merged = ONLY.length ? { ...prior, ...result } : result;
  const out = { asOf: new Date().toISOString().slice(0, 10), source: "SEC EDGAR XBRL, reportable-segment and geographic disclosures", companies: merged };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`\n✅ Segments: ${hit}/${companies.length} companies with a usable breakdown (${Object.keys(merged).length} total in file)`);
}

export { parseContexts, parseFacts, membersOnAxis, reconcile, prettify, AGGREGATE, isCompanyMember };

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
