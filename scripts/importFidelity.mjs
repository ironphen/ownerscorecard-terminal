#!/usr/bin/env node
// Converts a Fidelity "Portfolio_Positions_MonDDYYYY.xlsx" export (closed
// positions + Historical_returns sheets) into the site's data files:
//
//   src/data/performance.json , monthly time-weighted returns per account
//   src/data/ledger.json      , realized (closed) positions
//
// Usage:
//   npm run import:fidelity -- path/to/Portfolio_Positions_Jun062026.xlsx

import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

const file = process.argv[2];
if (!file) {
  die(
    `Usage:\n  npm run import:fidelity -- path/to/Portfolio_Positions_MonDDYYYY.xlsx`
  );
}
if (!fs.existsSync(file)) die(`File not found: ${file}`);

const wb = XLSX.read(fs.readFileSync(file), { cellDates: true });

const dataDir = path.join(process.cwd(), "src", "data");
if (!fs.existsSync(dataDir)) die(`Could not find ${dataDir}`);

// ---------------------------------------------------------------- helpers

const num = (v) =>
  typeof v === "number" ? v : v == null || v === "--" ? null : Number(v) || null;

const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const round4 = (v) => (v == null ? null : Math.round(v * 10000) / 10000);

function toMonthKey(v) {
  // Date object or Excel serial → "YYYY-MM"
  let d = v;
  if (typeof v === "number") {
    d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
  }
  if (!(d instanceof Date) || isNaN(d)) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// " -RMBS270115C100" → { underlying, expiry, kind, strike }
function parseOptionSymbol(raw) {
  const m = raw.match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])([\d.]+)$/);
  if (!m) return null;
  const [, underlying, yy, mm, dd, cp, strike] = m;
  return {
    underlying,
    expiry: `20${yy}-${mm}-${dd}`,
    kind: cp === "C" ? "call" : "put",
    strike: Number(strike),
  };
}

// Trim broker boilerplate from security descriptions
function cleanName(desc) {
  return String(desc || "")
    .replace(/\s*ISIN\s*#\S+/g, "")
    .replace(/\s*SEDOL\s*#\S+/g, "")
    .replace(/\*[^*]*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------------------------------------------- positions sheet

const posSheetName = wb.SheetNames.find((n) => /portfolio_positions/i.test(n));
if (!posSheetName) die(`No "Portfolio_Positions..." sheet found in ${file}`);

const posRows = XLSX.utils.sheet_to_json(wb.Sheets[posSheetName], {
  header: 1,
  raw: true,
});

const headerIdx = posRows.findIndex((r) => r && r.includes("Symbol"));
if (headerIdx < 0) die(`No "Symbol" header row found in ${posSheetName}`);

const positions = [];
for (const row of posRows.slice(headerIdx + 1)) {
  if (!row || row[2] == null || row[3] == null) continue;

  const account = String(row[1] || "").trim();
  const rawSymbol = String(row[2]).trim().replace(/^-/, "");
  const description = String(row[3]).trim();

  const costBasis = num(row[4]);
  const proceeds = num(row[5]);
  const gainShort = num(row[6]);
  const gainLong = num(row[7]);
  const gain = num(row[8]);
  if (gain == null) continue;

  const opt = parseOptionSymbol(rawSymbol);
  const term =
    gainShort != null && gainLong != null
      ? "mixed"
      : gainLong != null
        ? "long"
        : "short";

  let entry;
  if (opt) {
    entry = { ...opt, symbol: rawSymbol };
  } else if (/^CUR/.test(rawSymbol)) {
    entry = {
      underlying: rawSymbol.replace(/^CUR/, "").replace(/\d+$/, ""),
      symbol: rawSymbol,
      kind: "fx",
    };
  } else {
    const symbol = rawSymbol.replace(/\s+/g, ".");
    entry = { underlying: symbol, symbol, kind: "stock" };
  }

  positions.push({
    ...entry,
    name: cleanName(description),
    account,
    term,
    costBasis: round2(costBasis),
    proceeds: round2(proceeds),
    gain: round2(gain),
    gainPct: costBasis ? round4(gain / costBasis) : null,
  });
}

if (!positions.length) die("Parsed 0 positions, is this the right export?");
positions.sort((a, b) => b.gain - a.gain);

// -------------------------------------------------------- returns sheet

const retSheetName = wb.SheetNames.find((n) => /historical_returns/i.test(n));
if (!retSheetName) die(`No "Historical_returns" sheet found in ${file}`);

const retRows = XLSX.utils.sheet_to_json(wb.Sheets[retSheetName], {
  header: 1,
  raw: true,
});

// "Prior month end performance as of May-31-2026" → "2026-05-31"
let asOf = null;
for (const row of retRows) {
  const m = String(row?.[0] || "").match(/as of\s+([A-Za-z]{3})-(\d{2})-(\d{4})/);
  if (m) {
    const months = "JanFebMarAprMayJunJulAugSepOctNovDec";
    const mm = months.indexOf(m[1]) / 3 + 1;
    asOf = `${m[3]}-${String(mm).padStart(2, "0")}-${m[2]}`;
    break;
  }
}

const twrIdx = retRows.findIndex((r) =>
  /time-weighted/i.test(String(r?.[0] || ""))
);
if (twrIdx < 0) die(`No "Time-weighted rate of return" row in ${retSheetName}`);

const monthKeys = retRows[twrIdx].slice(1).map(toMonthKey);

const ACCOUNT_KEYS = {
  "401(K)": "k401",
  Individual: "individual",
  "Rollover IRA": "rolloverIra",
  Total: "total",
};

const seriesByAccount = {};
for (const row of retRows.slice(twrIdx + 1)) {
  const label = String(row?.[0] || "").trim();
  const key = ACCOUNT_KEYS[label];
  if (!key) continue;
  seriesByAccount[key] = row.slice(1).map(num);
}
if (!seriesByAccount.total) die("No 'Total' return series found.");

// Columns arrive newest-first; emit one row per month, ascending
const months = monthKeys
  .map((month, i) => {
    if (!month) return null;
    const row = { month };
    for (const [key, vals] of Object.entries(seriesByAccount)) {
      row[key] = round4(vals[i]);
    }
    return row;
  })
  .filter(Boolean)
  .sort((a, b) => a.month.localeCompare(b.month));

// ------------------------------------------------------------- write out

const performance = {
  asOf,
  source: path.basename(file),
  note: "Time-weighted monthly returns (pre-tax), as reported by broker.",
  months,
};

fs.writeFileSync(
  path.join(dataDir, "performance.json"),
  JSON.stringify(performance, null, 2) + "\n"
);
fs.writeFileSync(
  path.join(dataDir, "ledger.json"),
  JSON.stringify({ asOf, source: path.basename(file), positions }, null, 2) + "\n"
);

// ------------------------------------------------------------- summary

const cumulative = months.reduce(
  (acc, m) => (m.total == null ? acc : acc * (1 + m.total)),
  1
);
const net = positions.reduce((s, p) => s + p.gain, 0);
const wins = positions.filter((p) => p.gain > 0).length;

console.log(`✅ Imported ${path.basename(file)} (as of ${asOf})`);
console.log(`   Returns:   ${months.length} months (${months[0].month} → ${months.at(-1).month})`);
console.log(`   Cumulative TWR (Total): ${((cumulative - 1) * 100).toFixed(1)}%`);
console.log(`   Ledger:    ${positions.length} closed positions, ${wins} wins / ${positions.length - wins} losses`);
console.log(`   Net realized P/L: $${net.toFixed(2)}`);
