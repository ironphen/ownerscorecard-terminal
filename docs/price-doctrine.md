# The quarterly price, and how it enters the house

2026-07-10, on the owner's directive: a static ten-year price history per company, refreshed
quarterly, feeding the reverse-DCF so readers stop hunting a quote elsewhere — funded properly
("I am willing to put money into this project on things that Warren would deem worthwhile for
his own use"). This document is the doctrine and the design; the provider/licensing research
runs separately and picks the source.

## Why a quarterly price is not a price feed

The site's rule has been "the reader brings the price," and its deepest reason stands: this
publication never pronounces on price. But a DATED historical price is a fact, not a verdict —
Graham's tables were full of them, the Value Line sheet Buffett actually used opens with the
ten-year price chart, Moody's printed price ranges. What the rule must keep banning is the
verdict (targets, fair values) and the ticker-tape (live quotes that put Mr. Market at the desk).
A QUARTERLY close is Buffett's own cadence — check the business constantly, the price
occasionally — and it arrives with the same rhythm as the filings themselves. Mr. Market gets
a chair in the archive, never a seat at the desk.

## The two design rules

1. **Price renders only against the business, never alone.** A bare price chart is Mr. Market's
   mood diary. The chart is the de-rating form from our own moat note: per-share owner earnings
   and the quarterly price, BOTH INDEXED to the starting year, so a decade of divergence shows
   without asserting any fair multiple. (Value Line's earnings-line overlay scales price to a
   chosen multiple — that choice smuggles in a valuation anchor; indexing does not.) No shading
   of "cheap" regions, no bands, no annotations beyond the fiscal years. Financials/REITs use
   the per-share line their pages already read on (tangible book per share / FFO per share).
2. **The reference price wears its date, everywhere it acts.** The valuation tool's input stays
   the reader's. Beside it, a dated chip: "Mar 31 close: $211.40". One click fills the input —
   and every sentence computed from it renders in the PAST TENSE WITH THE DATE ("At $211.40,
   the March 31 close, the market WAS pricing …"). The moment the reader types a price of their
   own, the phrasing returns to the present. Staleness is stated, never worn as currency.

## Architecture

- `src/data/prices.json` — per ticker: ~40 quarterly adjusted closes (10 years), the as-of
  date, and the source name; split/dividend-adjusted from the provider. Size ~1.5–2MB: a
  build-data file, NEVER imported by anything BaseLayout or SSR touches (the 47MB worker
  lesson).
- `scripts/fetchPrices.mjs` + `.github/workflows/prices.yml` — quarterly cron (a few days
  after quarter end), ~3,530 requests per run, merge-over-last-good, the same audits/test gate
  discipline as every data workflow. Provider API key in repo secrets.
- Chart: build-time SVG (RecordCharts conventions) on company pages — "The business and the
  price, indexed" — dated, with the source named in the caption.
- Valuation: the dated chip + past-tense lede rule above; the chip also renders in compare
  columns. The share-count arithmetic already uses sharesForValue.
- JP (34 names): included if the chosen provider covers TSE cheaply; otherwise the JP pages
  simply keep today's behavior — never a guessed source.

## The licensing reality (researched and adversarially verified, 2026-07-10)

No retail-priced vendor licenses public display. Verified verbatim from the providers' own
terms: EODHD's retail tiers are personal-use with "displaying" expressly prohibited (their
$399/mo commercial tier is internal-use only; display is a custom quote); Polygon/Massive
prohibits building anything "for use by end users other than you" and names CHARTS as
prohibited Derived Works (display tier: $1,999/mo); Tiingo is "internal consumption only"
with redistribution "upon special request... additional fees"; FMP bars display on all
self-serve tiers; Twelve Data's cheapest display-licensed tier is Venture at $499/mo — the
cheapest verified licensed path anywhere. Marketstack's terms are silent, and silence is not
permission. Historical/EOD-only use changes NOTHING contractually — no provider's terms
carve out delayed or historical data. Unlicensed routes (yfinance, scraping) are foreclosed
by the publication's own doctrine: a provenance-first masthead cannot sit on unlicensed data.

**The path chosen (what Warren would do — negotiate, never overpay, ship what's free):**
1. DO NOT buy any retail tier (contractually barred) and DO NOT pay $499+/mo for a
   convenience feature against $0 revenue — that is the institutional imperative in a party
   hat. 2. The owner emails small-volume display quotes to Tiingo (their invitation is
   explicit; $50/mo commercial base is the lowest anchor found) and EODHD, scoped to ~14,000
   historical EOD requests/YEAR rendered as static quarterly charts with attribution — drafts
   in marketing/quote-drafts/. 3. Meanwhile, ship the license-free version of the reader's
   pain: THE PRICE MEMORY — the reader's own typed price persists on their device
   (localStorage), returns as a dated line on the next visit ("using your price from Jul 7 —
   type today's to update"), URL ?px= precedence preserved. Their number, remembered; no feed,
   no license, most of the convenience. 4. The indexed chart and the quarterly reference chip
   ship if and when a quote comes back inside sanity; the design above is ready for that day.

## What this never becomes

No live or daily quotes; no intraday anything; no price alerts; no "52-week high" framing; no
returns leaderboards; no price-based sorting anywhere a record table sorts; the /c/TICKER.json
machine endpoint keeps carrying NO price (provenance surface for the record, and provider
licenses restrict redistribution — display and raw redistribution are different rights). The
budget rises for exactly one thing: data bought properly, with public display rights, from a
named source.
