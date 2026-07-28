// filingRhythm.mjs — pure helpers for the wire's "coming due" band.
//
// Kept free of node: imports on purpose: this module renders inside page code under the
// Cloudflare adapter, where a node:fs import took /docs/data to a zero-byte page (2026-07-21).
//
// The band's honesty rests on two rules encoded here:
//
//   STEADINESS — day-level placement is only claimed for a company whose own record supports it.
//   Measured across its recent same-form filing lags: with six on file, at most one may sit more
//   than two days from the median (one hiccup quarter doesn't erase a metronome — ADC filed
//   21,21,31,22,22,23); with fewer than five (a 10-K's three), every lag must hold within two
//   days. A company that fails is simply absent from the band — counted, never listed — and the
//   wire records it when it actually files. CSX (16–36 day smear) fails; SNA (19 six straight
//   quarters) passes.
//
//   FILING DAYS — nothing is filed on a weekend, so an expectation that lands on Saturday or
//   Sunday reads as the following Monday, and the band's window is counted in business days.
//   Federal holidays are not modeled: a company whose window crosses one appears a day early,
//   still within "coming days" — a modest overstatement of urgency, never a missed name.

// Month-level phrase for a COMPUTED period end ("late June"): the precision the arithmetic honestly
// supports (52/53-week calendars drift by days), shared by the wire's coming-due band and the company
// page's next-report line so the two surfaces speak identically.
export const monthPhrase = (iso) => {
  const d = new Date(iso + "T00:00:00Z");
  const part = d.getUTCDate() <= 10 ? "early" : d.getUTCDate() <= 20 ? "mid" : "late";
  return `${part} ${d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })}`;
};

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

export function isSteadyRhythm(lags) {
  if (!Array.isArray(lags) || lags.length < 3) return false;
  const m = median(lags);
  const misses = lags.filter((x) => Math.abs(x - m) > 2).length;
  return misses <= (lags.length >= 5 ? 1 : 0);
}

export const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// The estimate range for a company's next report (owner directive, 2026-07-21: lead the line
// with a plain date estimate; a range absorbs the honest uncertainty). Built from the filer's
// own recent lags: a steady rhythm estimates from its trimmed core (the lags within two days of
// the median — one hiccup quarter doesn't widen the window); a looser rhythm estimates from its
// full spread when that stays reasonably tight; and where the spread is too wide to estimate
// honestly, the statutory deadline leads instead — a filed fact, not a guess. Weekend endpoints
// roll to Monday; a window already underway clamps to today.
// Rebuilt 2026-07-25 after a backtest, and mostly narrowed rather than widened.
//
// The old rule fitted a band to the tightest part of a filer's history and produced a one-to-two
// day window. Held out against what companies actually did next, that window was right about half
// the time — a coin flip wearing the clothes of precision. Widening it until it was honest cost
// the whole point: a band right nine times in ten ends, on the median filer, ON the statutory
// deadline. It told a reader nothing the due date already told them as fact.
//
// So the estimate now has to earn its place, and for three quarters of companies it cannot. It is
// shown only where a filer's own recent rhythm puts the whole window at least five days clear of
// the deadline — that is 26% of the pool, where the band is right 88% of the time, runs about five
// days wide, and lands a week before the date the law requires. When it misses there it misses by
// a median of three days and never runs past the deadline, which stays a hard clamp. Everywhere
// else the reader gets the due date, which is a fact rather than a guess.
//
// The window is drawn from the last four filings padded two days either side. That beat every
// alternative tested, including a median-plus-or-minus band, because a filer's recent cadence
// predicts its next filing better than its whole history does — companies change reporting habits,
// and the old years dilute the signal.
// THE GATE, rebuilt 2026-07-27 on the owner's ruling. It used to be a magic constant: refuse the
// estimate unless the window closed at least five days before the statutory deadline. Backtested over
// 34,818 held-out predictions, that constant turned out not to select for accuracy at all — the
// filers it REFUSED with a tight record hit 86.8% and the ones it ADMITTED hit 86.9%, and the hit
// rate is flat across every lead value from one day to eight. It was measuring how CLOSE an estimate
// sits to the deadline, which is not the same thing as how UNCERTAIN it is, and the two come apart
// on exactly the most punctual filers. Apple, with six consecutive 34-day quarters, was refused
// because 40 − (34 + 2) = 4, one day under.
//
// The test is now the one the code was really trying to make: does the window close before the
// filing is legally due? If it does, it tells the reader something the due date does not. If it does
// not, the due date is the better number and it is a filed fact. Coverage 30% → 48%, hold-out
// accuracy 86.9% → 87.8%, and the 1,335 predictions this admits hit 89.2%. No constant to defend.
const PAD_DAYS = 2;

export function estimateRange(up, todayISO) {
  if (!up?.nextPeriodEnd || !up?.dueBy) return null;
  const lags = Array.isArray(up.lagsSameForm) ? up.lagsSameForm : [];
  const deadline = { kind: "deadline", lo: up.dueBy, hi: up.dueBy };
  if (lags.length < 4) return deadline;

  // THE FOUR MOST RECENT, which is what the note above always said and not what this line did until
  // 2026-07-27. lagsSameForm is built newest-first (fetchUpcoming walks EDGAR's filings.recent, which
  // is newest-first, and slices the six newest), so `lags.slice(-4)` took the four OLDEST of the six
  // and threw away the two quarters that matter most — the exact opposite of the rule this file
  // documents and the backtest ratified. Verified two ways: across upcoming.json the lag implied by
  // lastSameForm matches lags[0] for 2,471 companies and lags[last] for none; and Stryker's
  // [41,31,32,32,30,31] against a last filing of 2026-03-31 → 2026-05-11, which is 41 days.
  //
  // It cost 5.6 points of accuracy. Held out, the shipped window was right 81.7% of the time and the
  // four newest 87.3% — and 87.3% is the figure this file's own comment claims, which is how we know
  // the 2026-07-25 backtest measured the intended rule while the code shipped a different one. The
  // two windows disagree for 64% of six-lag filers. Fiserv is the clean example: its last two 10-Qs
  // took 30 and 36 days, its estimate was drawn from quarters three through six back, and as of
  // 2026-07-27 the printed window had expired with no filing.
  const recent = lags.slice(0, 4);
  const loLag = Math.min(...recent) - PAD_DAYS;
  const hiLag = Math.max(...recent) + PAD_DAYS;

  let lo = rollToBusinessDay(addDays(up.nextPeriodEnd, loLag));
  let hi = rollToBusinessDay(addDays(up.nextPeriodEnd, hiLag));

  // The test that decides whether an estimate says anything at all: does the whole window close
  // before the filing is legally due? If not, the deadline is the better number, and it is a fact.
  // (This replaced the clamp that used to pull hi back to the due date, which manufactured a window
  // ending exactly on the deadline — the due date wearing a costume.)
  if (hi >= up.dueBy) return deadline;

  if (todayISO && lo < todayISO) lo = rollToBusinessDay(todayISO);
  if (lo > hi || days(lo, hi) > 14) return deadline;
  return { kind: "estimate", lo, hi };
}

const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

// Month/day form for the estimate lead ("7/24"), per the owner's example.
export const fmtMD = (iso) => {
  const d = new Date(iso + "T00:00:00Z");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

export const isBusinessDay = (iso) => {
  const d = new Date(iso + "T00:00:00Z").getUTCDay();
  return d >= 1 && d <= 5;
};

export const rollToBusinessDay = (iso) => {
  let d = iso;
  while (!isBusinessDay(d)) d = addDays(d, 1);
  return d;
};

// The next n business days, starting from `fromISO` itself when it is one.
export function nextBusinessDays(fromISO, n) {
  const out = [];
  let d = fromISO;
  while (out.length < n) {
    if (isBusinessDay(d)) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}
