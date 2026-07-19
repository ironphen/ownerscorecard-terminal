#!/usr/bin/env node
// fetchVoteResults.mjs — what the owners said: the say-on-pay vote, from the company's own 8-K.
//
// After every shareholder meeting a company files an 8-K under Item 5.07 ("Submission of Matters
// to a Vote of Security Holders") stating each proposal's votes for, against, and abstaining.
// This fetcher extracts the advisory-vote-on-executive-compensation (say-on-pay) tally — the one
// line that completes the pay exhibit: what management was paid, what the business earned for
// owners, and what the owners said about the pay when asked. The counts ship exactly as filed;
// the page computes the support percentage with its basis stated in words.
//
// Discovery is free: the SEC submissions index carries each 8-K's item numbers, so 5.07 filings
// are found without downloading documents. The 8-K's reportDate is the meeting date. Say-on-pay
// is annual for most filers but TRIENNIAL for some — the scan walks back through up to four 5.07
// filings before concluding a company has no recent say-on-pay vote. A wrong number is worse
// than a missing one: any ambiguity (no recognizable proposal, unparseable counts, implausible
// magnitudes) withholds the company.
//
// Usage:
//   ONLY_VOTES=AAPL,MSFT node scripts/fetchVoteResults.mjs   # limit to tickers (rest carry over)
//   node scripts/fetchVoteResults.mjs                        # full US universe
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
    } catch (err) { if (a === 4) throw err; await sleep(600 * a); }
  }
}
async function getText(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
      if (res.status === 404) return null;
      if (res.status === 429) { if (a === 4) throw new Error("HTTP 429"); await sleep(1200 * a); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) { if (a === 4) throw err; await sleep(600 * a); }
  }
}

// ---- the say-on-pay tally from one 8-K's visible text ----
// The proposal is named in standard language ("advisory resolution/vote to approve [named]
// executive [officer] compensation", or "say-on-pay"); its For/Against/Abstain counts follow,
// either as a header row followed by numbers (Apple's layout) or as labeled values. The counts
// are large comma-grouped integers; the FREQUENCY vote ("1 year / 2 years / 3 years"), which
// often sits adjacent and also mentions executive compensation, is excluded by refusing any
// match whose following window carries the frequency options.
export function parseSayOnPay(html) {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#160;|&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#8220;|&#8221;/g, '"').replace(/&#8217;/g, "'").replace(/\s+/g, " ");
  // Anchor on the item heading where present; some filers (Microsoft) never write "Item 5.07" in
  // the body, so fall back to the section title, then to the whole document — the submissions
  // index already guarantees this filing IS a 5.07 filing, and the proposal-anchored forms below
  // carry the precision.
  let i507 = text.search(/Item\s*5\.07/i);
  if (i507 < 0) i507 = text.search(/Submission\s+of\s+Matters\s+to\s+a\s+Vote/i);
  if (i507 < 0) i507 = 0;
  const body = text.slice(i507, i507 + 30000);
  // "advisory" may be followed by punctuation and a non-binding qualifier in either spelling
  // (Fox: "on an advisory, nonbinding basis") — the head tolerates both, or the REAL say-on-pay
  // proposal never matches and the loop wanders into the wrong one.
  const propRe = /(advisory[,\s]+(?:and\s+)?(?:non-?binding[,\s]+)?(?:resolution|vote|proposal|basis)?[^.]{0,180}?(?:executive\s+(?:officer\s+)?compensation|compensation\s+(?:paid\s+to|of|to)\s+(?:the\s+|its\s+|our\s+)?(?:company'?s?\s+)?named\s+executive)|say[-\s]?on[-\s]?pay|approve,?\s+on\s+an\s+advisory[,\s]+(?:non-?binding[,\s]+)?basis,?[^.]{0,120}?compensation)/gi;
  const N = (s) => (s == null ? null : Number(s.replace(/,/g, "")));
  const plausible = (v) => v && v.for > 1e4 && v.against >= 0 && v.abstain >= 0 && v.for + v.against + v.abstain <= 5e12;
  let m;
  while ((m = propRe.exec(body))) {
    // The capture window ends at the NEXT proposal's boundary: cross-proposal bleed is how Fox's
    // frequency-vote anchor swallowed a defeated stockholder proposal's counts (4% For shipped as
    // "say-on-pay") and BlackBerry's narrative anchor swallowed a by-law proposal's — both caught
    // by adjudication against the rendered tables (2026-07-18). The tally for a matched proposal
    // can only sit between its own text and the next "Proposal N".
    // Boundaries come in both styles: "Proposal 6" and a bare numbered list (" 6. Advisory Vote on
    // Frequency…", BlackBerry). Without the numbered-list form, a say-on-pay window reached the
    // NEXT proposal's year-labeled frequency counts and the frequency guard killed the real match.
    let window = body.slice(m.index, m.index + 1600);
    const boundary = window.slice(20).search(/Proposal\s+(?:No\.\s*)?\d|Item\s+No\.\s*\d|\s\d{1,2}\.\s+[A-Z]/);
    if (boundary >= 0) window = window.slice(0, 20 + boundary);
    // A SHAREHOLDER proposal about executive compensation is not the say-on-pay vote, and the
    // FREQUENCY vote ("how often shall the advisory vote be held") is not it either — its counts
    // are labeled in years (Fox: "1 Year: 199,235,379"). Both are identified by the text just
    // before or inside the match.
    const before = body.slice(Math.max(0, m.index - 160), m.index);
    if (/(?:share|stock)(?:holder|owner)s?['’]?s?\s+proposal|proposal\s+(?:submitted|sponsored)\s+by/i.test(before + " " + m[0])) continue;
    if (/frequency/i.test(before + " " + m[0])) continue;
    if (/(?:one|1)\s*years?:?\s*[\d,]{4,}/i.test(window)) continue;
    if (/(?:one|1)\s*year\s+(?:two|2)\s*years?\s+(?:three|3)\s*years?/i.test(window)) continue;
    // Form C first — fully labeled counts, unambiguous even at distance (Coca-Cola, Exxon:
    // "Votes Cast For: 2,906,500,165 90.84 % Votes Cast Against: ... Abstentions: ...").
    const c = /Votes\s+Cast\s+For:?\s*([\d,]{4,})\s*(?:[\d.]+\s*%)?\s*Votes\s+Cast\s+Against:?\s*([\d,]{4,})\s*(?:[\d.]+\s*%)?\s*Abstentions?:?\s*([\d,]{4,})(?:\s*Broker\s+Non-?Votes?:?\s*([\d,]{4,}))?/i.exec(window);
    if (c) { const v = { for: N(c[1]), against: N(c[2]), abstain: N(c[3]), brokerNonVotes: N(c[4]) }; if (plausible(v)) return v; }
    // Form A — a "For Against Abstain [Broker Non-Votes]" header with the numbers DIRECTLY after
    // (Apple's layout). The tight adjacency is the safety: a director-election table, whose numbers
    // follow each nominee's NAME, never matches.
    const a = /For\s+Against\s+Abstain(?:ed|entions?)?\s*(Broker\s+Non-?Votes?)?\s+([\d,]{4,})\s+([\d,]{4,})\s+([\d,]{4,})(?:\s+([\d,]{4,}))?/i.exec(window.slice(0, 700));
    if (a) { const v = { for: N(a[2]), against: N(a[3]), abstain: N(a[4]), brokerNonVotes: N(a[5]) }; if (plausible(v)) return v; }
    // Form B — labeled counts ("For: 1,234 Against: 56 Abstain: 7").
    const b = /For:?\s*([\d,]{4,})\s+Against:?\s*([\d,]{4,})\s+Abstain(?:ed|entions?)?:?\s*([\d,]{4,})/i.exec(window.slice(0, 700));
    if (b) { const v = { for: N(b[1]), against: N(b[2]), abstain: N(b[3]), brokerNonVotes: null }; if (plausible(v)) return v; }
    // Form E — a proposal-ROW table: the say-on-pay row label with its three-to-four counts on the
    // same row (GE's later "Say on Pay 764,954,244 …" row; Microsoft's table row restating the
    // proposal text before its numbers). The first count must begin within 120 characters of the
    // anchor's end — tight enough that a different proposal's row, prose, or a director list can
    // never intervene — and must be 7+ digits (a real share tally, not a proposal number).
    // One optional status-and-percentage token may sit between label and counts (Microsoft's
    // "Approved 91.53 4,733,430,707 …" layout); a lone percentage can never be mistaken for a
    // tally because a tally needs 7+ digit characters.
    const after = body.slice(m.index + m[0].length, m.index + m[0].length + 320);
    const e = /^[^0-9]{0,120}(?:\d{1,2}(?:\.\d+)?\s*%?\s+)?([\d,]{7,})\s+([\d,]{4,})\s+([\d,]{4,})(?:\s+([\d,]{4,}))?/.exec(after);
    if (e) { const v = { for: N(e[1]), against: N(e[2]), abstain: N(e[3]), brokerNonVotes: N(e[4]) }; if (plausible(v)) return v; }
  }
  return null;
}

// ---- per-company: the LATEST 5.07 filing only — parse it or withhold ----
// No walking back through older filings: when the latest meeting's 8-K fails to parse, falling
// back to an earlier year would silently present a stale vote as the current one (Microsoft's
// 2022 tally surfaced under a 2025-dated pipeline before this rule). A triennial say-on-pay
// filer whose latest meeting simply had no such vote withholds honestly for the same reason —
// the parser cannot distinguish "no vote occurred" from "the vote is here and I missed it", and
// a wrong number is worse than a missing one.
async function voteResultFor(cik) {
  const padded = String(cik).padStart(10, "0");
  const sub = await getJSON(`https://data.sec.gov/submissions/CIK${padded}.json`);
  const r = sub?.filings?.recent;
  if (!r) return null;
  let f = null;
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i].startsWith("8-K") && /5\.07/.test(r.items?.[i] || "")) {
      f = { acc: r.accessionNumber[i].replace(/-/g, ""), doc: r.primaryDocument[i], filed: r.filingDate[i], meeting: r.reportDate[i] || null };
      break;
    }
  }
  if (!f) return null;
  // A company whose LATEST vote-results filing is itself years old (pending acquisition, gone
  // quiet, meeting suspended) gets an honest blank — an old tally presented as the current state
  // of owner sentiment is a wrong number wearing a date.
  if (f.meeting && (Date.now() - new Date(f.meeting).getTime()) / 864e5 > 500) return null;
  await sleep(THROTTLE_MS);
  const html = await getText(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.acc}/${f.doc}`);
  if (!html) return null;
  const sop = parseSayOnPay(html);
  if (!sop) return null;
  return {
    meetingDate: f.meeting, filed: f.filed, sayOnPay: sop,
    sourceUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.acc}/${f.doc}`,
  };
}

async function main() {
  const fund = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8"));
  const companies = (fund.companies || []).filter((c) => c.cik);
  const only = (process.env.ONLY_VOTES || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
  const targets = only.length ? companies.filter((c) => only.includes(String(c.ticker).toUpperCase())) : companies;
  console.log(`vote results: ${targets.length} companies${only.length ? " (ONLY_VOTES)" : ""}`);

  const outPath = path.join(dataDir, "voteResults.json");
  let prior = {};
  try { prior = JSON.parse(fs.readFileSync(outPath, "utf8")).companies || {}; } catch {}

  const result = {};
  let ok = 0, none = 0, err = 0, done = 0;
  for (const c of targets) {
    done++;
    const T = String(c.ticker).toUpperCase();
    try {
      await sleep(THROTTLE_MS);
      const r = await voteResultFor(c.cik);
      if (r) { result[T] = r; ok++; }
      else none++;
    } catch (e) { err++; console.warn(`  ! ${T}: ${e.message}`); }
    if (done % 100 === 0) console.log(`  …${done}/${targets.length} (${ok} parsed)`);
  }

  const merged = only.length ? { ...prior, ...result } : result;
  const out = { asOf: new Date().toISOString().slice(0, 10), source: "SEC 8-K Item 5.07 (Submission of Matters to a Vote of Security Holders); the say-on-pay tally as each company filed it", companies: merged };
  const tmp = outPath + ".tmp";
  fs.writeFileSync(tmp, compactJson(out));
  fs.renameSync(tmp, outPath);
  console.log(`\n✅ vote results: ${ok} parsed, ${none} without a parseable say-on-pay, ${err} errors; wrote ${Object.keys(merged).length} companies`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`\n❌ ${e.message}\n`); process.exit(1); });
}
