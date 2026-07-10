// The follows dashboard's joins — pure functions over the two static context files
// (/follow-context.json and /wire-lite.json) and the reader's followed tickers. The account
// page's client script renders exactly what these return, and scripts/followDashboardTest.mjs
// runs the same functions over the built files, so what is tested is what renders. No DOM in
// here, and no judgment: names, chapters, filed forms and dates — never a verdict.

// follow-context.json rows -> a Map keyed by ticker. Each entry carries the company page href
// (pool 2 = Japan lives under /jp/, everything else under /c/ — company-index.json's own
// convention), the industry chapter, and the latest annual filing facts.
export function decodeContext(ctx) {
  const industries = (ctx?.industries || []).map(([label, slug]) => ({ label, slug }));
  const byTicker = new Map();
  for (const row of ctx?.rows || []) {
    const [ticker, name, pool, ind, fy, form, periodEnd] = row;
    byTicker.set(ticker, {
      ticker,
      name,
      href: (pool === 2 ? "/jp/" : "/c/") + ticker,
      industry: ind >= 0 ? industries[ind] || null : null,
      fy,
      form,
      periodEnd,
    });
  }
  return byTicker;
}

// The one dated line under a followed company: the latest annual filing the library holds.
// "Latest annual" and not "latest" — the band above may hold a newer 8-K, and the two must
// never contradict. Null where the record carries no filing facts; absence renders as nothing,
// never as a mark.
export function filingLine(entry) {
  if (!entry) return null;
  const what = [entry.fy != null ? `FY${entry.fy}` : null, entry.form].filter(Boolean).join(" ");
  if (!what) return null;
  return entry.periodEnd
    ? `Latest annual filing: ${what} · period ended ${entry.periodEnd}`
    : `Latest annual filing: ${what}`;
}

// The band: wire items from the reader's companies, held to the seven days ending at the wire's
// own asOf stamp (the wire file can hold a longer tail; "this week" must mean this week), newest
// first, ties A to Z by ticker.
export function bandItems(wireLite, followedTickers, days = 7) {
  const followed = new Set(followedTickers || []);
  let floor = null;
  const asOf = wireLite?.asOf;
  if (typeof asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    const d = new Date(asOf + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - (days - 1));
    floor = d.toISOString().slice(0, 10);
  }
  return (wireLite?.items || [])
    .map(([ticker, form, label, date, href]) => ({ ticker, form, label, date, href }))
    .filter((it) => followed.has(it.ticker) && (!floor || it.date >= floor))
    .sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0
    );
}

// "2026-07-09" -> "Thu, Jul 9" — the wire page's own date form, so the band and /wire read alike.
export function fmtFilingDate(s) {
  return new Date(s + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
