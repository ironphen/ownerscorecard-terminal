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
import { isSteadyRhythm, rollToBusinessDay, nextBusinessDays, monthPhrase, estimateRange, fmtMD, isBusinessDay } from "../src/lib/filingRhythm.mjs";

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
  t("the lag list behind the median is stored for the steadiness gate", JSON.stringify(r?.lagsSameForm) === "[35,35,36]", r?.lagsSameForm);
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

// The month-boundary snap: a calendar filer's Q1 computed from its 10-K (Dec 31 + 91 = Apr 1)
// must read as the quarter ended March 31 — the band prints the period's month, so the flip
// from a month-end period to a month-start result is a wrong printed fact, not a drift.
{
  const r = rhythmOf(sub("Large accelerated filer", [
    ["10-K", "2025-12-31", "2026-02-20"],
    ["10-Q", "2025-09-30", "2025-11-04"],
    ["10-Q", "2025-06-30", "2025-08-05"],
    ["10-Q", "2025-03-31", "2025-05-06"],
  ]));
  t("calendar filer's Q1 snaps Apr 1 back to Mar 31", r?.nextForm === "10-Q" && r.nextPeriodEnd === "2026-03-31", r?.nextPeriodEnd);
}

// The 4-5-4 retail calendar (Home Depot's quarters end Feb 2, May 4, Aug 3…) genuinely ends
// early in the month: month-start periods must NOT snap — their months are their own.
{
  const r = rhythmOf(sub("Large accelerated filer", [
    ["10-Q", "2026-05-04", "2026-06-03"],
    ["10-K", "2026-02-01", "2026-03-20"],
    ["10-Q", "2025-11-02", "2025-12-02"],
    ["10-Q", "2025-08-03", "2025-09-02"],
  ]));
  t("a 4-5-4 retailer's month-start period end stays its own (Aug 3, no snap)", r?.nextPeriodEnd === "2026-08-03", r?.nextPeriodEnd);
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

// ---- the steadiness gate (lib/filingRhythm.mjs): day-level placement only where the record
// earns it. Six lags may carry ONE outlier past ±2 of the median (a hiccup quarter doesn't
// erase a metronome); fewer than five must all hold; under three lags is not a rhythm.
t("a metronome is steady (SNA: 19 six straight quarters)", isSteadyRhythm([19, 19, 19, 19, 19, 19]) === true);
t("one outlier in six is forgiven (the ADC shape)", isSteadyRhythm([21, 21, 31, 22, 22, 23]) === true);
t("two outliers in six are a smear, not a rhythm (the CSX shape)", isSteadyRhythm([22, 16, 23, 16, 17, 36]) === false);
t("three 10-K lags must all hold within ±2 (52,52,52 passes)", isSteadyRhythm([52, 52, 52]) === true);
t("three 10-K lags with one outlier fail (52,59,52)", isSteadyRhythm([52, 59, 52]) === false);
t("fewer than three lags is not a rhythm", isSteadyRhythm([22, 23]) === false && isSteadyRhythm(undefined) === false);

// ---- filing days: nothing files on a weekend. An expectation landing Saturday reads as Monday,
// and the band's two-day window is counted in business days (Friday's window is Fri + Mon).
t("a Saturday expectation rolls to Monday", rollToBusinessDay("2026-07-25") === "2026-07-27");
t("a business day stands", rollToBusinessDay("2026-07-21") === "2026-07-21");
t("Friday's two filing days are Friday and Monday", JSON.stringify(nextBusinessDays("2026-07-24", 2)) === JSON.stringify(["2026-07-24", "2026-07-27"]));
t("Tuesday's two filing days are Tuesday and Wednesday", JSON.stringify(nextBusinessDays("2026-07-21", 2)) === JSON.stringify(["2026-07-21", "2026-07-22"]));

// The shared month-level phrase for computed period ends — the precision the arithmetic honestly
// supports, spoken identically by the wire band and the company page's next-report line.
t("monthPhrase: day 10 is early, day 11 is mid", monthPhrase("2026-06-10") === "early June" && monthPhrase("2026-06-11") === "mid June");
t("monthPhrase: day 20 is mid, day 21 is late", monthPhrase("2026-06-20") === "mid June" && monthPhrase("2026-06-21") === "late June");
t("monthPhrase: month boundaries hold in UTC", monthPhrase("2026-07-01") === "early July" && monthPhrase("2026-06-30") === "late June");

// The estimate range (owner directive, 2026-07-21): a steady rhythm estimates from its trimmed
// lag core; a hiccup quarter doesn't widen the window; too-wide spreads fall back to the
// statutory deadline, a filed fact; endpoints roll off weekends and clamp to today.
// REBUILT 2026-07-25 after a backtest held every filer's most recent filing out and predicted it
// from the earlier ones. The old trimmed-core rule produced a one-to-two day window that was right
// about half the time. These cases encode what replaced it: a window drawn from the last four
// filings padded two days, shown ONLY where it closes at least five days before the statutory
// deadline — because a band honest enough to be right nine times in ten otherwise ends on the
// deadline itself and tells a reader nothing the due date already tells them.
{
  const jnj = { nextPeriodEnd: "2026-06-28", dueBy: "2026-08-07", statutoryDays: 40, lagsSameForm: [24, 24, 25, 24, 24, 25] };
  const r = estimateRange(jnj, "2026-07-21");
  t("a metronome earns an estimate, padded rather than hair-thin", r.kind === "estimate" && r.lo === "2026-07-21" && r.hi === "2026-07-27", r);
  t("the lead formats month/day", fmtMD(r.lo) === "7/21", fmtMD(r.lo));
}
{
  // The hiccup now WIDENS the window, and that is the point of the rebuild: trimming the outlier
  // away asserted a steadiness the filer had not earned, and the backtest charged us for it.
  const adc = { nextPeriodEnd: "2026-06-30", dueBy: "2026-08-09", statutoryDays: 40, lagsSameForm: [21, 21, 31, 22, 22, 23] };
  const r = estimateRange(adc, "2026-07-01");
  t("a hiccup quarter widens the window instead of being trimmed away", r.kind === "estimate" && r.lo === "2026-07-20" && r.hi === "2026-08-03", r);
}
{
  // NEWEST FIRST. lagsSameForm is stored the way EDGAR serves filings.recent — most recent first —
  // and every fixture here is written that way. It matters: this array is CSX's 16-to-36-day smear,
  // and it only falls back to the deadline if the smear is in the filer's RECENT record. That is the
  // rule doing its job, not an accident of array order.
  const csx = { nextPeriodEnd: "2026-06-30", dueBy: "2026-08-09", statutoryDays: 40, lagsSameForm: [36, 17, 16, 23, 16, 22] };
  const r = estimateRange(csx, "2026-07-01");
  t("a smeared rhythm falls back to the statutory deadline", r.kind === "deadline" && r.lo === "2026-08-09", r);
}
{
  // THE ORDERING ITSELF, pinned — the guard that was missing when estimateRange shipped reading
  // `lags.slice(-4)` against a newest-first array, taking the four OLDEST quarters and discarding
  // the two that matter most. It was worth 5.6 points of hold-out accuracy (81.7% against 87.3%),
  // and no test could see it because every fixture happened to be symmetric enough not to care.
  //
  // This one is not symmetric: the four newest are a tight 20-21 and the four oldest a loose 30-31,
  // so the two windows cannot be confused. If the estimate is ever drawn from the old end again,
  // this fails and says so by name.
  const drifted = { nextPeriodEnd: "2026-06-30", dueBy: "2026-08-09", statutoryDays: 40, lagsSameForm: [20, 21, 20, 21, 30, 31] };
  const r = estimateRange(drifted, "2026-07-01");
  t("the estimate is drawn from the NEWEST four filings, not the oldest four",
    r.kind === "estimate" && r.lo === "2026-07-20" && r.hi === "2026-07-23", r);
  // And the mirror: a filer whose recent quarters have LOOSENED loses the estimate its old ones
  // would have earned. Fiserv is the live case — its last two 10-Qs took 30 and 36 days while the
  // shipped window was drawn from quarters three to six back and had already expired unfiled.
  const loosened = { nextPeriodEnd: "2026-06-30", dueBy: "2026-08-09", statutoryDays: 40, lagsSameForm: [36, 30, 24, 25, 23, 25] };
  t("a filer whose recent record has loosened falls back to the deadline",
    estimateRange(loosened, "2026-07-01").kind === "deadline", estimateRange(loosened, "2026-07-01"));
}
{
  // THE GATE THAT DECIDES WHETHER AN ESTIMATE SAYS ANYTHING. A filer that reliably uses nearly all
  // of its statutory time gets the deadline, because a window ending on the due date is the due
  // date wearing a costume.
  const lateFiler = { nextPeriodEnd: "2026-06-30", dueBy: "2026-08-09", statutoryDays: 40, lagsSameForm: [37, 37, 38, 37, 37, 38] };
  t("a filer that uses its whole statutory window gets the deadline, not an estimate",
    estimateRange(lateFiler, "2026-07-01").kind === "deadline", estimateRange(lateFiler, "2026-07-01"));
  const earlyFiler = { nextPeriodEnd: "2026-06-30", dueBy: "2026-08-09", statutoryDays: 40, lagsSameForm: [25, 25, 26, 25, 25, 26] };
  t("a reliably early filer keeps its estimate", estimateRange(earlyFiler, "2026-07-01").kind === "estimate");
}
{
  const wk = { nextPeriodEnd: "2026-06-30", dueBy: "2026-08-09", statutoryDays: 40, lagsSameForm: [25, 25, 25, 25, 25, 25] };
  const r = estimateRange(wk, "2026-07-01");
  t("endpoints roll off weekends", r.lo === "2026-07-23" && r.hi === "2026-07-27" && isBusinessDay(r.lo) && isBusinessDay(r.hi), r);
}
{
  const mid = { nextPeriodEnd: "2026-06-30", dueBy: "2026-08-09", statutoryDays: 40, lagsSameForm: [20, 20, 21, 20, 21, 22] };
  const r = estimateRange(mid, "2026-07-21");
  // hi is 7/23, from the four NEWEST lags [20,20,21,20] (max 21, padded to 23). It read 7/24 until
  // 2026-07-27, off the four oldest — this expectation was encoding the bug rather than the rule.
  t("a window already underway clamps its start to today", r.kind === "estimate" && r.lo === "2026-07-21" && r.hi === "2026-07-23", r);
  const missed = estimateRange({ ...mid, lagsSameForm: [20, 20, 21, 20, 21, 20] }, "2026-07-27");
  t("a window entirely in the past falls back to the deadline", missed.kind === "deadline", missed);
}
{
  // Under four filings is not a rhythm; the record has not earned a day-level claim.
  const thin = { nextPeriodEnd: "2026-06-30", dueBy: "2026-08-09", statutoryDays: 40, lagsSameForm: [25, 25, 25] };
  t("three filings are not enough to estimate from", estimateRange(thin, "2026-07-01").kind === "deadline");
}

if (failed) { console.error(`\n❌ upcomingTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ upcomingTest passed.");
