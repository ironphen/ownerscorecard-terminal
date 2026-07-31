// Offline regression for grahamTests' two honesty rules.
//
// 1. The dividend record: a year the filings simply didn't tag (a null dividendsPaid) inside an
//    otherwise-paid run is UNKNOWN, not a suspension — LHX paid through FY2020 but the tag is
//    missing, and "9 of 10 yrs" on an unbroken record was a false break. But a RUN of empty years
//    is a real suspension (Boeing 2021–24), a leading gap is a non-paying past, and an all-null
//    record is a non-payer: all of those must keep counting as unpaid. A missing read is unknown;
//    the streak is judged on the tagged years, and the gap is named.
// 2. Test 7 quotes the same 3-year-average EPS the calculator's Graham gate runs on
//    (Valuation.astro's eps3 basis), with the latest year as the aside — never a lone peak year
//    carried into a gate judged on the average.
import { grahamTests } from "../src/lib/graham.mjs";

let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? "ok   " : "FAIL ") + name); cond ? pass++ : fail++; };

// A synthetic ten-year record; only dividendsPaid varies per case.
const co = (divs, extra = {}) => ({
  ticker: "T",
  currency: "USD",
  lines: { netIncome: 110, sharesDiluted: 10, stockholdersEquity: 500, revenue: 3e9 },
  history: divs.map((d, i) => ({ fy: 2016 + i, lines: { netIncome: 90 + i * 5, dividendsPaid: d } })),
  ...extra,
});
const divTest = (divs) => grahamTests(co(divs)).tests.find((t) => t.name === "Dividend record");

// Unbroken, fully tagged.
{
  const t = divTest([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  check("fully tagged unbroken record passes", t.status === "pass" && t.value === "paid every year (10)");
}
// The LHX shape: one untagged year between paid years → unknown, named, streak intact.
{
  const t = divTest([1, 1, 1, 1, null, 1, 1, 1, 1, 1]);
  check("lone interior null is untagged, not a break", t.status === "pass");
  check("…and the gap is named in the value", t.value === "paid every tagged year (9 of 10)");
  check("…and carried on the row (untagged=1, delta null)", t.untagged === 1 && t.delta === null);
  check("…and named in the note", /untagged in the data/.test(t.note));
}
// The Boeing shape: a RUN of empty years between payments is a suspension, not a tag gap.
{
  const t = divTest([1, 1, 1, 1, 1, null, null, null, null, 1]);
  check("a null run is a suspension → fail", t.status === "fail" && t.untagged === 0);
  check("…counted over the full window", t.value === "6 of 10 yrs");
}
// A leading gap: nulls before the first payment are a non-paying past, not a tag gap.
{
  const t = divTest([null, null, null, null, 1, 1, 1, 1, 1, 1]);
  check("a recent initiator does not read as unbroken", t.status !== "pass" && t.untagged === 0);
}
// A tagged zero is a real zero: still a break even beside paid years.
{
  const t = divTest([1, 1, 1, 1, 0, 1, 1, 1, 1, 1]);
  check("a tagged zero year breaks the streak", t.status !== "pass" && t.untagged === 0);
}
// An ALL-NULL column is withheld, never failed (UX survey ruling 2026-07-31): not one year
// carries the tag, so the record holds no evidence either way — the partnership pattern, where
// distributions file under tags the chain doesn't read (EPD pays ~$4.7B a year). A true
// non-payer that ever TAGGED a zero year still fails (the case above); silence is not a zero.
{
  const t = divTest([null, null, null, null, null, null, null, null, null, null]);
  check("an all-null record is withheld, not a non-payer", t.status === "na" && /no dividend line tagged/.test(t.value));
}

// Test 7: the quoted EPS is the 3-year average (the calculator's gate basis), latest year the aside.
{
  const c = co([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  // history netIncome: ...125, 130, 135 → 3-yr avg 130; latest annual line 110; 10 shares.
  const t = grahamTests(c).tests.find((x) => x.name === "Moderate price");
  check("test 7 quotes the 3-yr average EPS", /Three-year average earnings are \$13\.00\/share/.test(t.note));
  check("…with the latest year as the aside", /\(latest year \$11\.00\)/.test(t.note));
  check("…and names the gate it feeds", /the averaged base the calculator's gate runs on/.test(t.note));
}
// The dated filing-cover count (sharesForValue) wins when present — Valuation.astro's exact chain.
{
  const c = co([1, 1, 1, 1, 1, 1, 1, 1, 1, 1], { sharesForValue: { val: 20 } });
  const t = grahamTests(c).tests.find((x) => x.name === "Moderate price");
  check("test 7 uses the sharesForValue count when present", /Three-year average earnings are \$6\.50\/share/.test(t.note));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
