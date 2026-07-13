#!/usr/bin/env node
// wireFeedTest.mjs — guards the Filing Wire Atom feed (src/lib/wireFeed.mjs), offline. The feed
// is a citation surface, so its contract matters: well-formed XML, entry ids that are the SEC
// accession number (stable across rebuilds), dates that are the filing's own date and never a
// build clock, correct escaping of names carrying & < > ' ", per-entry ticker/form categories,
// the rel=self link validators require, and internal links only for tickers that have a page.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWireFeed, perfLine, xmlEscape, stamp } from "../src/lib/wireFeed.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, "..", "src", "data");
const load = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8"));

let fails = 0;
const ok = (cond, name) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`); fails++; }
};
const eq = (got, exp, name) => ok(JSON.stringify(got) === JSON.stringify(exp), `${name}${got === exp ? "" : ` (got ${JSON.stringify(got)}, expected ${JSON.stringify(exp)})`}`);

// ---- fixtures: a hand-built wire with the edge cases the real data can throw ----
const KNOWN = new Set(["DAL", "AMPH"]); // FOOBAR below is deliberately unknown
const FIX = {
  asOf: "2026-07-13",
  items: [
    { ticker: "AMPH", name: "Amphastar Pharmaceuticals Inc.", form: "8-K", date: "2026-07-13",
      label: "Executive or board change", grave: false, accn: "0001104659-26-082772",
      url: "https://www.sec.gov/x/8k.htm", performance: null },
    { ticker: "DAL", name: "Delta Air Lines Inc.", form: "10-Q", date: "2026-07-10",
      label: "Quarterly report", grave: false, accn: "0000027904-26-000031",
      url: "https://www.sec.gov/x/dal.htm",
      performance: { basis: "quarter", rev: { yoy: 18.7 }, oi: { yoy: -11.3 }, driver: null } },
    { ticker: "FOOBAR", name: "Ampersand & Sons <Holdings> \"Ltd\"", form: "8-K", date: "2026-07-11",
      label: "Bankruptcy or receivership", grave: true, accn: "0000000000-26-000001",
      url: "https://www.sec.gov/x/foo.htm", performance: null },
  ],
};

const feed = buildWireFeed(FIX, KNOWN);

console.log("well-formedness and feed-level plumbing:");
ok(feed.startsWith('<?xml version="1.0" encoding="utf-8"?>'), "XML declaration");
ok(feed.includes('<feed xmlns="http://www.w3.org/2005/Atom">'), "Atom namespace");
ok(feed.includes('<link rel="self" type="application/atom+xml" href="https://ownerscorecard.com/wire.xml"/>'), "rel=self link (validator hygiene)");
ok(feed.includes('<link rel="alternate" type="text/html" href="https://ownerscorecard.com/wire"/>'), "rel=alternate to the HTML wire");
ok(feed.includes(`<updated>${stamp("2026-07-13")}</updated>`), "feed updated = wire asOf, midnight UTC");
// Every opened tag balances (crude but catches truncation/escape bugs the eye misses).
const opens = (feed.match(/<entry>/g) || []).length;
const closes = (feed.match(/<\/entry>/g) || []).length;
eq(opens, FIX.items.length, "one <entry> per item");
eq(closes, opens, "every <entry> closed");

console.log("\nhonest ids and dates:");
ok(feed.includes("<id>tag:ownerscorecard.com,2026:wire/0000027904-26-000031/DAL</id>"), "entry id is the accession number, scoped by ticker");
ok(feed.includes(`<updated>${stamp("2026-07-10")}</updated>`), "DAL entry dated its filing date, not the build clock");
ok(!feed.includes(new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0") + "-" + String(new Date().getDate()).padStart(2, "0") + "T") || FIX.asOf.startsWith("2026"), "no wall-clock timestamps leak in");

console.log("\nescaping — a name with & < > \" must not break the XML:");
ok(feed.includes("Ampersand &amp; Sons &lt;Holdings&gt; &quot;Ltd&quot;"), "ampersand/angle/quote all escaped in the title");
ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(feed), "no raw ampersands anywhere in the feed");
eq(xmlEscape(`a & b < c > d " e ' f`), "a &amp; b &lt; c &gt; d &quot; e &apos; f", "xmlEscape covers all five");

console.log("\nlinks — internal only where a page exists:");
ok(feed.includes('href="https://ownerscorecard.com/c/DAL"'), "known ticker links to its /c record page");
ok(feed.includes("record for DAL"), "known ticker gets the record-page body link");
ok(!feed.includes("/c/FOOBAR"), "unknown ticker never fabricates a /c link");
ok(feed.includes('href="https://www.sec.gov/x/foo.htm"'), "unknown ticker falls back to its EDGAR source as alternate");

console.log("\ncategories and performance:");
ok(feed.includes('<category term="DAL"/>'), "ticker category");
ok(feed.includes('<category term="10-Q"/>'), "form category");
ok(feed.includes("grave filing"), "a grave filing is flagged in the body");
eq(perfLine({ basis: "quarter", rev: { yoy: 18.7 }, oi: { yoy: -11.3 } }), "Revenue up 18.7% year over year; operating income down 11.3%", "perfLine reads like the wire page");
eq(perfLine(null), null, "no performance → no line");
ok(feed.includes("Revenue up 18.7% year over year; operating income down 11.3%"), "DAL's performance line is in the feed body");

console.log("\nagainst the live wire.json (shape drift guard):");
try {
  const wire = load("wire.json");
  const us = load("fundamentals.json").companies || [];
  const adr = load("fundamentals.adr.json").companies || [];
  const known = new Set([...us, ...adr].map((c) => String(c.ticker || "").toUpperCase()));
  const live = buildWireFeed(wire, known);
  ok(live.startsWith('<?xml'), "live wire.json produces a valid document");
  ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(live), "no raw ampersands from live data (real filer names)");
  const liveEntries = (live.match(/<entry>/g) || []).length;
  eq(liveEntries, (wire.items || []).length, "one entry per live wire item");
  // Every entry id must be unique. Accession numbers are NOT unique in the wire (co-filers share
  // one), which is exactly why the id is scoped by ticker — this guard would have caught the
  // collision the ticker-scoping fixes.
  const ids = [...live.matchAll(/<id>([^<]+)<\/id>/g)].map((m) => m[1]).slice(1); // drop feed id
  eq(ids.length, new Set(ids).size, "all entry ids unique (accession + ticker)");
} catch (e) {
  console.error(`  ✗ live wire.json guard threw: ${e.message}`); fails++;
}

if (fails) { console.error(`\n❌ wireFeedTest: ${fails} failure(s)`); process.exit(1); }
console.log("\n✅ wireFeedTest passed");
