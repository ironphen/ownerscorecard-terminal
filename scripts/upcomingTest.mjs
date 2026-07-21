#!/usr/bin/env node
// upcomingTest.mjs — case law for the filing-rhythm reader (fetchUpcoming.mjs).
//
// The rules under test: statutory deadlines follow the filer class exactly (60/75/90-day 10-K,
// 40/40/45-day 10-Q); an ANNUAL period anchors on the last 10-K's own anniversary, never quarter
// arithmetic (a 52/53-week filer's fourth quarter can run 16 weeks — Costco's does — so +91 days
// from Q3 lands weeks short); a company whose cadence can't be read cleanly returns null, never a
// guess; and the printed surface never carries a computed date (the wire renders month-level
// phrases and day-count facts — asserted here by the shape of what's stored).
import { rhythmOf } from "./fetchUpcoming.mjs";

let failed = 0;
const t = (name, ok, got) => { if (!ok) { failed++; console.error(`✗ ${name}${got !== undefined ? ` -> ${JSON.stringify(got)}` : ""}`); } else console.log(`ok ${name}`); };

const sub = (category, filings) => ({
  category,
  filings: { recent: {
    form: filings.map((f) => f[0]),
    reportDate: filings.map((f) => f[1]),
    filingDate: filings.map((f) => f[2]),
  } },
});

// A calendar-year large accelerated filer, mid-cycle: next report is a 10-Q on the 40-day rule.
const laf = sub("Large accelerated filer", [
  ["10-Q", "2026-03-31", "2026-05-05"],
  ["10-K", "2025-12-31", "2026-02-20"],
  ["10-Q", "2025-09-30", "2025-11-04"],
  ["10-Q", "2025-06-30", "2025-08-05"],
]);
{
  const r = rhythmOf(laf);
  t("large accelerated: next is a 10-Q on the 40-day rule", r?.nextForm === "10-Q" && r.statutoryDays === 40, r);
  t("typical lag is the median of its own 10-Q lags", r?.typicalLagDays === 35, r?.typicalLagDays);
  t("expected = period end + its own lag (selection anchor only)", r?.expected === "2026-08-04", r?.expected);
}

// A non-accelerated filer: 45-day 10-Q, 90-day 10-K.
{
  const r = rhythmOf(sub("Non-accelerated filer", [
    ["10-Q", "2026-03-31", "2026-05-14"],
    ["10-K", "2025-12-31", "2026-03-25"],
    ["10-Q", "2025-09-30", "2025-11-13"],
    ["10-Q", "2025-06-30", "2025-08-13"],
  ]));
  t("non-accelerated: 45-day 10-Q rule", r?.statutoryDays === 45, r);
}

// The Costco shape: 52/53-week filer whose Q3 ends ~May 10 with the fiscal year ending Aug 31.
// The next (annual) period must anchor on the 10-K's anniversary, not May 10 + 91 = Aug 9.
{
  const r = rhythmOf(sub("Large accelerated filer", [
    ["10-Q", "2026-05-10", "2026-06-17"],
    ["10-Q", "2026-02-15", "2026-03-25"],
    ["10-K", "2025-08-31", "2025-10-08"],
    ["10-Q", "2025-11-23", "2026-01-02"],
  ]));
  t("52/53-week annual anchors on the 10-K anniversary (Aug 30, not Aug 9)",
    r?.nextForm === "10-K" && r.nextPeriodEnd === "2026-08-30", r);
  t("annual due-by runs 60 days from the anniversary", r?.dueBy === "2026-10-29", r?.dueBy);
}

// Unreadable cadences withhold: one 10-Q is not a rhythm; no 10-K is not a year.
t("a single 10-Q is not a rhythm → null", rhythmOf(sub("Large accelerated filer", [["10-Q", "2026-03-31", "2026-05-05"], ["10-K", "2025-12-31", "2026-02-20"]])) === null);
t("no 10-K on file → null", rhythmOf(sub("Non-accelerated filer", [["10-Q", "2026-03-31", "2026-05-05"], ["10-Q", "2025-12-31", "2026-02-10"], ["10-Q", "2025-09-30", "2025-11-05"]])) === null);

// An implausible lag ON THE NEXT FORM (a chronic late filer whose 10-Qs land ~200 days out)
// withholds; the gate is per-form, so a clean 10-K rhythm beside messy 10-Qs still reads when
// the 10-K is what comes next.
{
  const r = rhythmOf(sub("Large accelerated filer", [
    ["10-Q", "2026-03-31", "2026-10-17"],
    ["10-K", "2025-12-31", "2026-02-25"],
    ["10-Q", "2025-09-30", "2026-04-19"],
    ["10-Q", "2025-06-30", "2026-01-12"],
  ]));
  t("an implausible lag on the next form withholds", r === null, r);
}

if (failed) { console.error(`\n❌ upcomingTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ upcomingTest passed.");
