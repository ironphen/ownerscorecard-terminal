#!/usr/bin/env node
// fetchWire.mjs — the Filing Wire.
//
// The site's "alive daily" without a price feed or an LLM: every new filing across
// the catalog, straight from EDGAR, with 8-K item codes turned into plain language
// (so an auditor change or a restatement announces itself). Lightweight — just the
// submissions feeds — so it can run on its own daily schedule. Writes wire.json.
//   npm run fetch:wire

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const UA = process.env.SEC_USER_AGENT || "Owner Scorecard research (ryanreinsant@gmail.com)";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const dataDir = path.join(process.cwd(), "src", "data");
const fundamentals = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAYS = 150; // recency window

async function getJSON(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429) { await sleep(1000 * a); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { if (a === 4) throw e; await sleep(500 * a); }
  }
}

const FORM_LABEL = {
  "10-K": "Annual report", "10-K/A": "Annual report (amended)",
  "10-Q": "Quarterly report", "8-K": "Current report", "DEF 14A": "Proxy statement",
};

// 8-K item codes → what actually happened. The grave ones (4.01, 4.02, 2.04) are the
// Graham red flags an owner wants to see the moment they're filed.
const ITEM_8K = {
  "1.01": "Entered a material agreement", "1.02": "Ended a material agreement",
  "2.01": "Completed an acquisition or disposal", "2.02": "Reported results",
  "2.03": "Took on a financial obligation", "2.04": "Debt accelerated or in default",
  "2.05": "Restructuring / exit costs", "2.06": "Material impairment",
  "3.01": "Delisting or listing-rule notice", "3.02": "Sold unregistered shares",
  "3.03": "Changed shareholder rights", "4.01": "Changed its auditor",
  "4.02": "Said prior financials can't be relied on", "5.01": "Change in control",
  "5.02": "Executive or board change", "5.03": "Amended charter or bylaws",
  "5.07": "Shareholder vote", "7.01": "Reg FD disclosure", "8.01": "Other event",
};
const isFiller = (c) => c === "9.01" || c === "7.01" || c === "8.01";

function label8K(items) {
  const codes = (items || "").split(",").map((s) => s.trim()).filter((c) => ITEM_8K[c]);
  codes.sort((a, b) => isFiller(a) - isFiller(b)); // substance before filler
  return codes.length ? ITEM_8K[codes[0]] : "Current report";
}

async function main() {
  const cutoff = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
  const items = [];
  for (const c of fundamentals.companies) {
    if (!c.cik) continue;
    await sleep(150);
    let j;
    try { j = await getJSON(`https://data.sec.gov/submissions/CIK${c.cik}.json`); }
    catch (e) { console.warn(`  ! ${c.ticker}: ${e.message}`); continue; }
    const r = j.filings?.recent;
    if (!r?.form) continue;
    for (let i = 0; i < r.form.length; i++) {
      const form = r.form[i], date = r.filingDate[i];
      if (!FORM_LABEL[form] || !date || date < cutoff) continue;
      const accn = r.accessionNumber[i], doc = r.primaryDocument[i];
      const url = accn && doc ? `https://www.sec.gov/Archives/edgar/data/${Number(c.cik)}/${accn.replace(/-/g, "")}/${doc}` : null;
      const label = form === "8-K" ? label8K(r.items?.[i]) : FORM_LABEL[form];
      const grave = form === "8-K" && /can't be relied on|Changed its auditor|default|impairment|Delisting/.test(label);
      items.push({ ticker: c.ticker, name: c.name || c.ticker, form, date, label, grave, url });
    }
  }
  items.sort((a, b) => b.date.localeCompare(a.date) || a.ticker.localeCompare(b.ticker));
  const out = { asOf: new Date().toISOString().slice(0, 10), source: "SEC EDGAR — recent filings", items: items.slice(0, 90) };
  fs.writeFileSync(path.join(dataDir, "wire.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`✅ Wire: ${out.items.length} filings since ${cutoff}`);
}

export { label8K, ITEM_8K };

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
