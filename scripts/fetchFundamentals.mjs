#!/usr/bin/env node
// Build-time fundamentals pipeline.
//
// Reads src/data/universe.json (tickers + names), resolves each ticker to a CIK
// via SEC's official ticker map, pulls the latest annual (10-K) figures from the
// EDGAR XBRL "companyfacts" API, and writes src/data/fundamentals.json — the
// static dataset every fundamentals tool reads.
//
//   npm run fetch:fundamentals
//
// Needs outbound access to sec.gov / data.sec.gov. SEC asks for a descriptive
// User-Agent with contact info; override via SEC_USER_AGENT if you like.
// Free, no API key. Runs unattended in CI (see .github/workflows/fundamentals.yml).

import fs from "node:fs";
import path from "node:path";

const UA =
  process.env.SEC_USER_AGENT ||
  "Owner Scorecard research (ryanreinsant@gmail.com)";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const THROTTLE_MS = 150; // stay well under SEC's ~10 req/s guidance

const dataDir = path.join(process.cwd(), "src", "data");
const universe = JSON.parse(fs.readFileSync(path.join(dataDir, "universe.json"), "utf8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429) {
        await sleep(1000 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === 4) throw err;
      await sleep(500 * attempt);
    }
  }
}

// Concept tags in priority order. Companies report under different tags, so we
// try each and take the first that yields a usable annual figure.
const CONCEPTS = {
  operatingIncome: ["OperatingIncomeLoss"],
  interestExpense: ["InterestExpense", "InterestExpenseNonoperating", "InterestAndDebtExpense"],
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax"],
  netIncome: ["NetIncomeLoss"],
  cashFromOps: ["NetCashProvidedByUsedInOperatingActivities"],
  depreciation: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  longTermDebt: ["LongTermDebtNoncurrent", "LongTermDebt"],
  currentDebt: ["LongTermDebtCurrent", "DebtCurrent"],
};

const days = (a, b) => Math.abs((new Date(b) - new Date(a)) / 86400000);

// Pick the latest full-year (~annual duration) value from a 10-K for a concept.
function pickAnnual(facts, tags) {
  for (const tag of tags) {
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.USD;
    if (!units) continue;
    const annual = units
      .filter((u) => u.form && u.form.startsWith("10-K") && u.start && u.end && days(u.start, u.end) >= 350 && days(u.start, u.end) <= 380)
      .sort((a, b) => new Date(b.end) - new Date(a.end));
    if (annual.length) return { ...annual[0], tag };
  }
  return null;
}

// Pick the latest point-in-time (instant) value from a 10-K — for balance-sheet items.
function pickInstant(facts, tags) {
  for (const tag of tags) {
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.USD;
    if (!units) continue;
    const inst = units
      .filter((u) => u.form && u.form.startsWith("10-K") && u.end && !u.start)
      .sort((a, b) => new Date(b.end) - new Date(a.end));
    if (inst.length) return { ...inst[0], tag };
  }
  return null;
}

async function main() {
  process.stdout.write("Resolving tickers → CIK from SEC… ");
  const map = await getJSON("https://www.sec.gov/files/company_tickers.json");
  const cikByTicker = {};
  for (const row of Object.values(map)) {
    cikByTicker[String(row.ticker).toUpperCase()] = String(row.cik_str).padStart(10, "0");
  }
  console.log("done.");

  const companies = [];
  for (const { ticker, name } of universe.tickers) {
    const cik = cikByTicker[ticker.toUpperCase()];
    if (!cik) {
      console.warn(`  ! ${ticker}: no CIK in SEC map, skipping`);
      continue;
    }
    await sleep(THROTTLE_MS);
    let facts;
    try {
      facts = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    } catch (err) {
      console.warn(`  ! ${ticker}: companyfacts failed (${err.message}), skipping`);
      continue;
    }

    const oi = pickAnnual(facts, CONCEPTS.operatingIncome);
    const anchor = oi || pickAnnual(facts, CONCEPTS.revenue); // for fy / period / filing link
    const ltd = pickInstant(facts, CONCEPTS.longTermDebt);
    const cur = pickInstant(facts, CONCEPTS.currentDebt);
    const totalDebt =
      ltd || cur ? (ltd?.val || 0) + (cur?.val || 0) : null;

    const pick = (tags) => pickAnnual(facts, tags)?.val ?? null;
    const accnNoDash = anchor?.accn ? anchor.accn.replace(/-/g, "") : null;
    const sourceUrl = accnNoDash
      ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accnNoDash}/${anchor.accn}-index.htm`
      : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K&count=10`;

    companies.push({
      ticker: ticker.toUpperCase(),
      name,
      cik,
      fy: anchor?.fy ?? null,
      periodEnd: anchor?.end ?? null,
      form: anchor?.form ?? "10-K",
      sourceUrl,
      lines: {
        operatingIncome: oi?.val ?? null,
        interestExpense: pick(CONCEPTS.interestExpense),
        revenue: pick(CONCEPTS.revenue),
        netIncome: pick(CONCEPTS.netIncome),
        totalDebt,
        cashFromOps: pick(CONCEPTS.cashFromOps),
        depreciation: pick(CONCEPTS.depreciation),
        capex: pick(CONCEPTS.capex),
      },
    });
    console.log(`  ✓ ${ticker} (CIK ${cik}, FY${anchor?.fy ?? "?"})`);
  }

  if (!companies.length) {
    console.error("\n❌ No companies resolved — aborting so the sample file is preserved.\n");
    process.exit(1);
  }

  const out = {
    asOf: new Date().toISOString().slice(0, 10),
    source: "SEC EDGAR XBRL (companyfacts)",
    sample: false,
    note: "Latest annual (10-K) figures pulled from EDGAR. Values are raw USD.",
    companies,
  };
  fs.writeFileSync(path.join(dataDir, "fundamentals.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`\n✅ Wrote ${companies.length} companies to src/data/fundamentals.json`);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
});
