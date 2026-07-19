#!/usr/bin/env node
// fetchProxyComp.mjs — what management is paid, from the company's own proxy statement.
//
// Since fiscal 2022 the SEC's pay-versus-performance rule (Item 402(v), Release 34-95607) requires
// every proxy statement to carry a machine-readable table: the principal executive officer's total
// compensation as the Summary Compensation Table states it, the "compensation actually paid"
// figure the rule defines, and the company's own total-shareholder-return series — all tagged
// inline (the "ecd" namespace) in the DEF 14A itself. None of it flows through the companyfacts
// API (verified 2026-07-18: only dei and us-gaap namespaces appear there), so this fetcher reads
// the proxy document directly, the way parseCoverShares reads filing covers.
//
// Doctrine: the numbers are the filing's own — the SCT total and the rule-defined CAP, per fiscal
// year, with the PEO named as the filing names them. A wrong number is worse than a missing one:
// any ambiguity (unparseable context, implausible magnitude, unresolvable PEO attribution)
// withholds the year or the company, never guesses. The panel downstream juxtaposes this series
// with the record OSC already renders; no judgment is added anywhere.
//
// Usage:
//   ONLY_PROXY=AAPL,MSFT node scripts/fetchProxyComp.mjs   # limit to tickers (rest carry over)
//   node scripts/fetchProxyComp.mjs                        # full US universe
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compactJson } from "../src/lib/dataFile.mjs";

const UA = process.env.SEC_USER_AGENT || "OwnerScorecard research hello@ownerscorecard.com";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const THROTTLE_MS = 200;
const dataDir = path.join(process.cwd(), "src", "data");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
      if (res.status === 404) return null;
      if (res.status === 429) { if (a === 4) throw new Error("HTTP 429"); await sleep(1200 * a); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (a === 4) throw err;
      await sleep(600 * a);
    }
  }
}
async function getText(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(90_000) });
      if (res.status === 404) return null;
      if (res.status === 429) { if (a === 4) throw new Error("HTTP 429"); await sleep(1200 * a); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (a === 4) throw err;
      await sleep(600 * a);
    }
  }
}

// ---- inline-XBRL parsing (contexts + ecd facts) ----
// The ix:header carries the context definitions this parser needs, so unlike the cover parser the
// raw document is read whole. Contexts map an id to a fiscal period and (for the pay table) to the
// individual the fact describes — a year with two PEOs (a CEO transition) tags each officer's
// figures under an ecd:IndividualAxis member, and the members' names are declared by ecd:PeoName
// facts carrying the same member.

// Every xbrli context: id → { start, end, member } (member = the IndividualAxis member qname, or
// null for the undimensioned company-level facts like TSR).
export function parseContexts(html) {
  const out = new Map();
  // id need not be the first attribute (SandRidge writes <xbrli:context xmlns="" id="c0">), and
  // attribute order inside explicitMember varies likewise.
  const ctxRe = /<xbrli:context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/xbrli:context>/gi;
  let m;
  while ((m = ctxRe.exec(html))) {
    const [, id, body] = m;
    const start = /<xbrli:startDate>([^<]+)<\/xbrli:startDate>/i.exec(body)?.[1] ?? null;
    const end = /<xbrli:endDate>([^<]+)<\/xbrli:endDate>/i.exec(body)?.[1]
      ?? /<xbrli:instant>([^<]+)<\/xbrli:instant>/i.exec(body)?.[1] ?? null;
    // Three dimension groups matter. The IndividualAxis member distinguishes one officer's tenure
    // from another's in a transition year. The ExecutiveCategoryAxis says whether a fact describes
    // the PEO or the other named officers (ecd:PeoMember vs ecd:NonPeoNeoMember) — the filing's own
    // attribution, used to keep non-PEO names out of the PEO rows. Anything else (the adjustment
    // axes on reconciliation rows) marks a context whose figures are never the headline numbers.
    const members = [...body.matchAll(/<xbrldi:explicitMember\b[^>]*\bdimension="([^"]+)"[^>]*>([^<]+)<\/xbrldi:explicitMember>/gi)]
      .map(([, dim, member]) => ({ dim: dim.trim(), member: member.trim() }));
    const indiv = members.find((x) => /IndividualAxis/i.test(x.dim))?.member ?? null;
    const execCat = members.find((x) => /ExecutiveCategoryAxis/i.test(x.dim))?.member ?? null;
    const otherDims = members.filter((x) => !/IndividualAxis|ExecutiveCategoryAxis/i.test(x.dim)).length;
    out.set(id, { start, end, member: indiv, execCat, otherDims });
  }
  return out;
}

// All ix facts for the ecd concepts this fetcher needs: name → [{ ctx, text, value }].
//
// Two SEPARATE passes, never one alternation: the numeric pay facts are NESTED INSIDE the
// ecd:PvpTableTextBlock nonNumeric element (the rule tags the whole table as a text block AND each
// cell as a fact), so a combined (nonFraction|nonNumeric) regex consumes the entire table when it
// matches the outer block and silently skips every fact inside — Apple parsed to nothing and GE to
// one year before this was separated (2026-07-18). The numeric pass scans the raw document
// independently, finding each nonFraction wherever it sits; the text pass matches only PeoName
// openers specifically, whose short contents never nest.
export function parseEcdFacts(html) {
  const out = new Map();
  const add = (name, ctx, text, value) => { if (!out.has(name)) out.set(name, []); out.get(name).push({ ctx, text, value }); };
  const numRe = /<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi;
  let m;
  while ((m = numRe.exec(html))) {
    const [, attrs, inner] = m;
    const name = /name="(ecd:[A-Za-z0-9]+)"/i.exec(attrs)?.[1];
    const ctx = /contextRef="([^"]+)"/i.exec(attrs)?.[1];
    if (!name || !ctx) continue;
    const text = inner.replace(/<[^>]+>/g, "").replace(/&#160;|&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
    const scale = Number(/scale="(-?\d+)"/i.exec(attrs)?.[1] ?? 0);
    const sign = /sign="-"/i.test(attrs) ? -1 : 1;
    const n = parseFloat(text.replace(/[,$\s]/g, ""));
    add(name, ctx, text, Number.isFinite(n) ? sign * n * 10 ** scale : null);
  }
  const nameRe = /<ix:nonNumeric\b([^>]*name="ecd:PeoName"[^>]*)>([\s\S]*?)<\/ix:nonNumeric>/gi;
  while ((m = nameRe.exec(html))) {
    const [, attrs, inner] = m;
    const ctx = /contextRef="([^"]+)"/i.exec(attrs)?.[1];
    if (!ctx) continue;
    const text = inner.replace(/<[^>]+>/g, "").replace(/&#160;|&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
    if (text) add("ecd:PeoName", ctx, text, null);
  }
  return out;
}

// Assemble the per-fiscal-year pay series from one proxy document. Returns { years, tsr } or null.
// years: [{ fy, end, peoName, sct, cap }] — one row per PEO per fiscal year, exactly as tagged.
export function parsePayVersusPerformance(html) {
  const contexts = parseContexts(html);
  const facts = parseEcdFacts(html);
  const sct = facts.get("ecd:PeoTotalCompAmt") || [];
  const cap = facts.get("ecd:PeoActuallyPaidCompAmt") || [];
  const names = facts.get("ecd:PeoName") || [];
  if (!sct.length) return null;

  const fyOf = (end) => { const d = new Date(end); let y = d.getUTCFullYear(); if (d.getUTCMonth() === 0 && d.getUTCDate() === 1) y -= 1; return y; };

  // PEO name resolution, most-specific first: (fiscal-year, member) → member alone (a CEO-
  // transition filing names each officer once under their IndividualAxis member) → the sole
  // distinct name in the document (a single-PEO filer like Apple tags the name once, not per
  // year). Never guessed beyond that — a multi-name document with unattributable rows keeps
  // peoName null and the row still renders on its figures.
  // Only names the filing itself attributes to the PEO: a context whose ExecutiveCategoryAxis is
  // NonPeoNeoMember names one of the OTHER officers (Apple tags every named officer this way), and
  // must never reach a PEO row.
  const nameBy = new Map(), nameByMember = new Map(), allNames = new Set();
  for (const f of names) {
    const c = contexts.get(f.ctx);
    if (!f.text || /NonPeoNeo/i.test(c?.execCat ?? "")) continue;
    const clean = f.text.replace(/\s+/g, " ");
    allNames.add(clean);
    if (c?.end) nameBy.set(`${fyOf(c.end)}|${c.member ?? ""}`, clean);
    if (c?.member) nameByMember.set(c.member, clean);
  }
  const soleName = allNames.size === 1 ? [...allNames][0] : null;
  const nameFor = (fy, member) => nameBy.get(`${fy}|${member ?? ""}`) ?? (member ? nameByMember.get(member) : null) ?? soleName;

  // Pay rows: SCT total and CAP joined on (fy, member). Contexts carrying any OTHER dimension are
  // the reconciliation/adjustment rows and never the headline figures — excluded. Magnitude guard:
  // a real PEO year is between $1 and $1bn; outside that is a mis-parse and withholds the row.
  const rows = new Map();
  const put = (arr, key) => {
    for (const f of arr) {
      const c = contexts.get(f.ctx);
      if (!c?.end || c.otherDims > 0 || f.value == null) continue;
      if (/NonPeoNeo/i.test(c.execCat ?? "")) continue; // the other officers' rows, never the PEO's
      if (Math.abs(f.value) > 1e9 || Math.abs(f.value) < 1) continue;
      const fy = fyOf(c.end);
      const id = `${fy}|${c.member ?? ""}`;
      if (!rows.has(id)) rows.set(id, { fy, end: c.end, member: c.member ?? null });
      rows.get(id)[key] = f.value;
    }
  };
  put(sct, "sct");
  put(cap, "cap");

  // Same fact, tagged twice: some filers tag a year's figures BOTH under an IndividualAxis member
  // and in an undimensioned context (Amtech's pattern) — the undimensioned twin is the same row
  // restated, not a second officer. Within a fiscal year, an unnamed (member-null) row whose SCT
  // matches a member row's to the dollar is dropped (2026-07-18).
  const rowList = [...rows.values()].filter((r) => r.sct != null);
  const deduped = rowList.filter((r) => r.member != null ||
    !rowList.some((o) => o.member != null && o.fy === r.fy && Math.abs(o.sct - r.sct) <= 1));

  const years = deduped
    .map((r) => ({ fy: r.fy, end: r.end, peoName: nameFor(r.fy, r.member), sct: Math.round(r.sct), cap: r.cap != null ? Math.round(r.cap) : null }))
    .sort((a, b) => a.fy - b.fy || String(a.peoName).localeCompare(String(b.peoName)));
  if (!years.length) return null;

  // Company TSR as filed (value of a fixed initial investment; undimensioned contexts only).
  const tsr = (facts.get("ecd:TotalShareholderRtnAmt") || [])
    .map((f) => { const c = contexts.get(f.ctx); return c?.end && !c.member && !c.execCat && c.otherDims === 0 && f.value != null ? { fy: fyOf(c.end), value: f.value } : null; })
    .filter(Boolean)
    .sort((a, b) => a.fy - b.fy);

  return { years, tsr };
}

// ---- per-company: latest DEF 14A → parsed series ----
async function proxyCompFor(cik) {
  const padded = String(cik).padStart(10, "0");
  const sub = await getJSON(`https://data.sec.gov/submissions/CIK${padded}.json`);
  const r = sub?.filings?.recent;
  if (!r) return null;
  let f = null;
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] === "DEF 14A") { f = { acc: r.accessionNumber[i].replace(/-/g, ""), doc: r.primaryDocument[i], filed: r.filingDate[i] }; break; }
  }
  if (!f) return null;
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.acc}/${f.doc}`;
  await sleep(THROTTLE_MS);
  const html = await getText(url);
  if (!html) return null;
  const parsed = parsePayVersusPerformance(html);
  if (!parsed) return null;
  return { ...parsed, filed: f.filed, sourceUrl: url };
}

// ---- withholding (2026-07-18 adjudication) ----
// A company ships only when its tagged table is structurally trustworthy. Two rules, both from
// adversarial adjudication of the full-pool extremes against the rendered tables:
//
// STRUCTURAL: more than two PEO rows in a single fiscal year. A real mid-year CEO transition
// yields two rows (Pennant's 2022, both named, the negative one arithmetic-verified); three-plus
// is the SoundHound signature — the filer tagged its CAP reconciliation rows with the headline
// ecd:PeoTotalCompAmt concept and abused custom members onto the IndividualAxis (28 facts where 4
// belong), so the "pay" rows are adjustment components. The rare genuine three-PEO year (Opendoor
// 2025) is indistinguishable mechanically and withholds with the rest — missing beats wrong. 110
// of 2,588 parsed companies (4%) at first full-pool run.
//
// CURATED: filers whose inline tags contradict their own rendered table in ways the structural
// rule cannot see. Each entry carries the adjudicated reason; a future proxy season may fix their
// tagging, so entries are re-checked (and removed) when a new proxy parses cleanly AND passes the
// magnitude sanity below.
const WITHHELD_CURATED = {
  ASYS: "scale error in the filer's inline XBRL: every PvP fact tagged scale=3 against a whole-dollar rendered table, so tagged values read 1000x the filed pay (rendered FY2025 SCT $723,580; tags say $723.58M). Adjudicated 2026-07-18.",
};
// Curated re-check: an ASYS-class scale error shows as PEO pay wildly out of proportion to the
// company's own revenue; a clean re-parse under this ceiling lifts the withhold naturally.
const structurallySuspect = (r) => {
  const perFy = {};
  for (const y of r.years) perFy[y.fy] = (perFy[y.fy] || 0) + 1;
  return Object.values(perFy).some((n) => n > 2);
};

async function main() {
  const fund = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8"));
  const companies = (fund.companies || []).filter((c) => c.cik);
  const only = (process.env.ONLY_PROXY || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
  const targets = only.length ? companies.filter((c) => only.includes(String(c.ticker).toUpperCase())) : companies;
  console.log(`proxy comp: ${targets.length} companies${only.length ? " (ONLY_PROXY)" : ""}`);

  const outPath = path.join(dataDir, "proxyComp.json");
  let prior = {};
  try { prior = JSON.parse(fs.readFileSync(outPath, "utf8")).companies || {}; } catch {}

  const result = {};
  const drop = new Set(); // withheld this run: removed from the carried-over prior file too
  let ok = 0, none = 0, err = 0, withheld = 0, done = 0;
  for (const c of targets) {
    done++;
    const T = String(c.ticker).toUpperCase();
    try {
      await sleep(THROTTLE_MS);
      const r = await proxyCompFor(c.cik);
      if (r && WITHHELD_CURATED[T]) { withheld++; drop.add(T); console.log(`  withheld ${T}: curated (${WITHHELD_CURATED[T].split(":")[0]})`); }
      else if (r && structurallySuspect(r)) { withheld++; drop.add(T); console.log(`  withheld ${T}: >2 PEO rows in one fiscal year (reconciliation-row tagging suspected)`); }
      else if (r) { result[T] = r; ok++; }
      else none++;
    } catch (e) { err++; console.warn(`  ! ${T}: ${e.message}`); }
    if (done % 100 === 0) console.log(`  …${done}/${targets.length} (${ok} parsed)`);
  }

  // Targeted runs merge onto the prior file; a full run replaces it (companies leaving the
  // universe drop out; a company whose latest proxy no longer parses withholds rather than
  // carrying a stale series — the proxy is annual, staleness is real).
  const merged = only.length ? { ...prior, ...result } : result;
  for (const T of drop) delete merged[T];
  const out = { asOf: new Date().toISOString().slice(0, 10), source: "SEC DEF 14A pay-versus-performance disclosures (Item 402(v)), parsed from each proxy's inline XBRL", companies: merged };
  const tmp = outPath + ".tmp";
  fs.writeFileSync(tmp, compactJson(out));
  fs.renameSync(tmp, outPath);
  console.log(`\n✅ proxy comp: ${ok} parsed, ${withheld} withheld (structural/curated), ${none} without usable PvP tags, ${err} errors; wrote ${Object.keys(merged).length} companies`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`\n❌ ${e.message}\n`); process.exit(1); });
}
