#!/usr/bin/env node
// Offline unit test for the EDINET parser's pure logic (no network). Feeds synthetic
// type=5 rows through parseFacts + buildRecord and checks the assembled record. The live
// fetch is exercised in CI; this guards the parsing, consolidated-preference, context
// filtering, five-year-summary reach, debt summing and shares-from-EPS logic.
//
//   node scripts/edinetTest.mjs

import { parseFacts, buildRecord, decodeCsv } from "./fetchEdinetFundamentals.mjs";

// Tab-separated, header first (skipped by the parser). Columns:
// element, item, context, relYear, consolidated, period, unit, unitName, value
const rows = [
  ["要素ID", "項目名", "コンテキストID", "相対年度", "連結・個別", "期間・時点", "ユニットID", "単位", "値"],
  // revenue: consolidated wins over individual; a segment context is rejected
  ["jppfs_cor:NetSales", "売上高", "CurrentYearDuration", "当期", "個別", "期間", "JPY", "円", "500000"],
  ["jppfs_cor:NetSales", "売上高", "CurrentYearDuration", "当期", "連結", "期間", "JPY", "円", "1000000"],
  ["jppfs_cor:NetSales", "売上高", "CurrentYearDuration_SomeSegmentMember", "当期", "連結", "期間", "JPY", "円", "123"],
  ["jppfs_cor:NetSales", "売上高", "Prior1YearDuration", "前期", "連結", "期間", "JPY", "円", "900000"],
  // a deeper year reached only through the five-year summary element
  ["jpcrp_cor:NetSalesSummaryOfBusinessResults", "売上高", "Prior2YearDuration", "前々期", "連結", "期間", "JPY", "円", "800000"],
  ["jppfs_cor:OperatingIncome", "営業利益", "CurrentYearDuration", "当期", "連結", "期間", "JPY", "円", "200000"],
  ["jppfs_cor:OrdinaryIncome", "経常利益", "CurrentYearDuration", "当期", "連結", "期間", "JPY", "円", "210000"],
  ["jppfs_cor:ProfitLossAttributableToOwnersOfParent", "親会社株主に帰属する当期純利益", "CurrentYearDuration", "当期", "連結", "期間", "JPY", "円", "150000"],
  ["jppfs_cor:NetCashProvidedByUsedInOperatingActivities", "営業CF", "CurrentYearDuration", "当期", "連結", "期間", "JPY", "円", "180000"],
  ["jppfs_cor:PurchaseOfPropertyPlantAndEquipment", "設備投資", "CurrentYearDuration", "当期", "連結", "期間", "JPY", "円", "-60000"],
  // balance sheet (instant)
  ["jppfs_cor:Assets", "総資産", "CurrentYearInstant", "当期末", "連結", "時点", "JPY", "円", "5000000"],
  ["jppfs_cor:NetAssets", "純資産", "CurrentYearInstant", "当期末", "連結", "時点", "JPY", "円", "3000000"],
  ["jppfs_cor:CashAndDeposits", "現金及び預金", "CurrentYearInstant", "当期末", "連結", "時点", "JPY", "円", "800000"],
  ["jppfs_cor:ShortTermLoansPayable", "短期借入金", "CurrentYearInstant", "当期末", "連結", "時点", "JPY", "円", "100000"],
  ["jppfs_cor:LongTermLoansPayable", "長期借入金", "CurrentYearInstant", "当期末", "連結", "時点", "JPY", "円", "400000"],
  // EPS from the summary, for shares-from-EPS
  ["jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults", "1株当たり当期純利益", "CurrentYearDuration", "当期", "連結", "期間", "JPYPerShares", "円", "150"],
];
const tsv = rows.map((r) => r.join("\t")).join("\r\n");

const store = parseFacts(tsv);
const rec = buildRecord(store, { fy: 2024, periodEnd: "2024-03-31", edinetCode: "E00000", secCode: "99990", docId: "S100TEST" }, { ticker: "9999", name: "Test KK", sector: "assetLight", industry: "Test" });

let failed = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${got}${ok ? "" : `  (expected ${want})`}`);
};

console.log("EDINET parser self-test");
eq("revenue (consolidated wins, segment rejected)", rec.lines.revenue, 1000000);
eq("operatingIncome", rec.lines.operatingIncome, 200000);
eq("ordinaryIncome", rec.lines.ordinaryIncome, 210000);
eq("netIncome", rec.lines.netIncome, 150000);
eq("cashFromOps", rec.lines.cashFromOps, 180000);
eq("capex (absolute)", rec.lines.capex, 60000);
eq("totalAssets", rec.lines.totalAssets, 5000000);
eq("stockholdersEquity (NetAssets fallback)", rec.lines.stockholdersEquity, 3000000);
eq("cashAndEquivalents", rec.lines.cashAndEquivalents, 800000);
eq("totalDebt (sum of loan parts)", rec.lines.totalDebt, 500000);
eq("epsBasic", rec.lines.epsBasic, 150);
eq("sharesDiluted (from EPS)", rec.lines.sharesDiluted, 1000);
eq("currency", rec.currency, "JPY");
eq("market", rec.market, "JP");
eq("history length (current + 2 prior reached)", rec.history.length, 3);
eq("history oldest fy (five-year-summary reach)", rec.history[0].fy, 2022);
eq("history oldest revenue (from summary)", rec.history[0].lines.revenue, 800000);

// Encoding detection: EDINET ships UTF-16; a wrong assumption parses nothing, so decodeCsv
// must recover the text from a UTF-16LE buffer (with BOM), UTF-16BE, and plain UTF-8.
const jp = "売上高\tNetSales\t連結";
const u16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(jp, "utf16le")]);
const u16be = (() => { const b = Buffer.from(jp, "utf16le"); b.swap16(); return Buffer.concat([Buffer.from([0xfe, 0xff]), b]); })();
const u8 = Buffer.from(jp, "utf8");
eq("decodeCsv UTF-16LE (BOM)", decodeCsv(u16le), jp);
eq("decodeCsv UTF-16BE (BOM)", decodeCsv(u16be), jp);
eq("decodeCsv UTF-8", decodeCsv(u8), jp);
// Full roundtrip through the real decode path (UTF-16LE buffer the parser will actually see).
const recFromBuf = buildRecord(parseFacts(decodeCsv(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(tsv, "utf16le")]))), { fy: 2024 }, { ticker: "9999", name: "Test KK" });
eq("revenue survives a UTF-16LE decode roundtrip", recFromBuf.lines.revenue, 1000000);

// EDINET wraps every field in double quotes (and tags the five-year summary as その他, not
// 連結). The real shape, to lock in the quote-stripping fix: revenue must unquote and parse.
const quoted = [
  ['"要素ID"', '"項目名"', '"コンテキストID"', '"相対年度"', '"連結・個別"', '"期間・時点"', '"ユニットID"', '"単位"', '"値"'],
  ['"jpcrp_cor:NetSalesSummaryOfBusinessResults"', '"売上高、経営指標等"', '"CurrentYearDuration"', '"当期"', '"その他"', '"期間"', '"JPY"', '"円"', '"152384000000"'],
  ['"jppfs_cor:OperatingIncome"', '"営業利益"', '"CurrentYearInstant"', '"当期末"', '"連結"', '"時点"', '"JPY"', '"円"', '"50000000000"'],
].map((r) => r.join("\t")).join("\r\n");
const qrec = buildRecord(parseFacts(quoted), { fy: 2026 }, { ticker: "9697", name: "Capcom" });
eq("quoted EDINET cells: revenue unquoted and parsed", qrec.lines.revenue, 152384000000);

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log("\n✅ All EDINET parser checks passed");
