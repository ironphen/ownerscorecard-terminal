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

const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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
