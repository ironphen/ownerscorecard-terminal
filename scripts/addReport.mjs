#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "https://files.ownerscorecard.com"; // <-- change if needed
const PREVIEW_EXT = "jpg"; // or "webp"
const PDF_EXT = "pdf";

const args = process.argv.slice(2);

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function isISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

if (args.length < 3) {
  die(
    `Usage:\n  node scripts/addReport.mjs TICKER "Company Name" YYYY-MM-DD\n\n` +
      `Example:\n  node scripts/addReport.mjs KO "Coca-Cola" 2025-12-09`
  );
}

const [tickerRaw, nameRaw, date] = args;

const ticker = tickerRaw.trim().toUpperCase();
const name = nameRaw.trim();

if (!/^[A-Z0-9.\-]+$/.test(ticker)) die(`Ticker looks invalid: ${ticker}`);
if (!name) die("Company name is required.");
if (!isISODate(date)) die(`Date must be YYYY-MM-DD. Got: ${date}`);

const fileBase = `${ticker}_${date}`;
const pdfUrl = `${BASE_URL}/${fileBase}.${PDF_EXT}`;
const previewUrl = `${BASE_URL}/${fileBase}.${PREVIEW_EXT}`;

const reportsPath = path.join(process.cwd(), "src", "data", "reports.json");
if (!fs.existsSync(reportsPath)) die(`Could not find ${reportsPath}`);

let reports;
try {
  reports = JSON.parse(fs.readFileSync(reportsPath, "utf8"));
} catch {
  die("reports.json is not valid JSON.");
}

if (!Array.isArray(reports)) die("reports.json must be an array.");

const newEntry = { ticker, name, date, pdfUrl, previewUrl };

const exists = reports.some(
  (r) =>
    (r.ticker || "").toUpperCase() === ticker &&
    r.date === date
);

if (exists) die(`An entry already exists for ${ticker} on ${date}.`);

reports.push(newEntry);

// Sort by ticker ASC, then date DESC
reports.sort((a, b) => {
  const ta = (a.ticker || "").toUpperCase();
  const tb = (b.ticker || "").toUpperCase();
  const tcmp = ta.localeCompare(tb);
  if (tcmp !== 0) return tcmp;
  return (b.date || "").localeCompare(a.date || "");
});

fs.writeFileSync(reportsPath, JSON.stringify(reports, null, 2) + "\n", "utf8");
console.log(`✅ Added: ${ticker} — ${name} — ${date}`);
console.log(`   PDF:     ${pdfUrl}`);
console.log(`   Preview: ${previewUrl}`);
