#!/usr/bin/env node
// adrRatiosTest.mjs — case law for the ADS-ratio parser (scripts/fetchAdrRatios.mjs).
//
// The 2026-07-17 sweep found 13 shipped ratios corrupted by three parser gaps: comma-grouped counts
// truncated ("each representing 2,000" read as 2), M-for-N programs inverted ("every 13 ADSs
// representing 10" read as 10, not 10/13), and multiword fractions collapsed ("one and one quarter"
// read as 1). Each corrected entry's VERBATIM cover clause is frozen here against the ratio the
// depositary program actually states, so a future ratio refetch can never re-corrupt them. Offline.
import { parseRatio } from "./fetchAdrRatios.mjs";

let failed = 0;
const t = (name, text, want) => {
  const got = parseRatio(text)?.ratio ?? null;
  const ok = want == null ? got == null : got != null && Math.abs(got - want) < 1e-4;
  if (!ok) { failed++; console.error(`✗ ${name}: got ${got}, want ${want}`); }
  else console.log(`ok ${name}`);
};

// --- comma-grouped counts (the truncation class) — verbatim from the filings ---
t("LTM 2,000", "American Depositary Shares (as evidenced by American Depositary Receipts), each representing 2,000 shares of Common Stock", 2000);
t("NAAS 3,200", "American depositary shares, each representing 3,200 Class A ordinary shares", 3200);
t("TC 4,800", "American depositary shares, each representing 4,800 Class A ordinary shares", 4800);
t("XHG 2,400", "American depositary shares, each of which represents 2,400 Class A ordinary shares", 2400);
t("SVREW 43,200", "American Depositary Shares, each representing 43,200 ordinary shares", 43200);

// --- M-for-N programs (the inversion class) — verbatim ---
t("SY 10/13", "American depositary shares, with every 13 ADSs representing 10 Class A ordinary shares", 0.769231);
t("GOTU 2/3", "American Depositary Shares, every three representing two Class A common shares", 0.666667);
t("RERE 2/3", "American depositary shares (every three ADSs represent two Class A ordinary shares)", 0.666667);
t("DDL 3/2", "American depositary shares, each two of which represent three Class A ordinary shares", 1.5);
t("JG 40/3", "American depositary shares, every 3 of which represent 40 Class A common shares", 13.333333);

// --- found by re-parsing every stored quote with the hardened parser (2026-07-18) ---
t("DDI 1/20", "American Depositary Shares, or ADSs, each twenty (20) ADSs representing one (1) Common Share", 0.05);
t("TAL 1/3", "American Depositary Shares, each three representing one Class A common share", 0.333333);

// --- multiword fractions — verbatim ---
t("SNY one half of one", "American Depositary Shares, each representing one half of one ordinary share", 0.5);
t("WKEY half a share", "American Depositary Shares, each representing half a Class B Share, par value CHF 0.10 per share", 0.5);
t("ADAG one and one quarter", "American depositary shares, each representing one and one quarter (1.25) of our ordinary shares", 1.25);

// --- the plain forms must keep parsing exactly as before (no regression) ---
t("each ADS represents one ordinary", "American Depositary Shares, each ADS represents one ordinary share", 1);
t("each representing two ordinary", "American Depositary Shares, each representing two ordinary shares", 2);
t("each representing 8 common", "American Depositary Shares, each representing 8 shares of common stock", 8);
t("parenthetical (each representing 0.25", "ADSs (each representing 0.25 ordinary shares)", 0.25);
t("every two ADSs represent one ordinary", "American depositary shares, every two ADSs represent one ordinary share", 0.5);
t("no program → null", "Common Stock, par value $0.01 per share, listed on the New York Stock Exchange", null);
t("debt prose → null", "Total debt outstanding of $2,000 million represents the aggregate principal", null);

if (failed) { console.error(`\n❌ adrRatiosTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ adrRatiosTest passed.");
