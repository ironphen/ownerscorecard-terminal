# International expansion — scope

2026-07-14. How to extend the catalog beyond the US, ADR, and Japan pools into home-market
international equities, starting with Europe. Written after the Almanac made coverage breadth a
first-class asset (a US-centered census is honestly labeled, but a broader one is more citable).

## The constraint that shapes everything: cover selectively, not exhaustively

The binding limit is Cloudflare's **20,000 static-asset ceiling** (free tier). Today: **11,333
files**, ~3 per covered company (page + two JSON twins). Headroom ≈ **2,900 companies** (or ~4,300
if home-market pages skip the `/c` JSON endpoint the way Japan already does). A *full* European
regulated universe is 5,000–8,000+ names, which would blow past the ceiling.

So the policy is: **cover the large, liquid names, not every micro-cap.** This is not a compromise
— it is better. Thin-data small-caps only add noise to the Almanac's base rates, and the pull
thesis wants the names people (and answer engines) actually ask about. If comprehensive coverage
is ever wanted, **Workers Paid ($5/mo) raises the ceiling to 100,000** — the clean unlock, on
doctrine (infrastructure, not attention). `scripts/verifyStatic.mjs` now prints the asset count and
fails before Cloudflare would.

## The format is standardized; the access is not

- **EU / EEA → ESEF.** Since financial years starting 2020, every issuer on an EU-regulated market
  files its annual report as Inline XBRL under IFRS (the ESEF taxonomy, an IFRS-taxonomy extension).
  Italy, France, Germany, Netherlands, Spain, the Nordics. Machine-readable, same shape as EDGAR /
  EDINET.
- **UK → UKSEF.** Post-Brexit the UK runs a parallel FCA regime, structurally near-identical iXBRL.
- **No single European repository.** Unlike EDGAR (one US system) and EDINET (one JP system),
  Europe's filings live in ~27 national OAMs (Italy: CONSOB / 1Info; UK: the FCA's National Storage
  Mechanism; France: AMF; Germany: Bundesanzeiger). ESMA's single access point (**ESAP**) will
  unify them but does not come online until ~2027. So today, access is per-country: pull from each
  OAM or from each issuer's own IR site (every issuer publishes its ESEF report there too).

**The real cost of a new market is the access + the taxonomy mapping, NOT the currency or the
math** — those already generalize (see below).

## What already generalizes (built and proven)

- **Currency.** Records are kept as-filed; the metrics the Almanac and cards use are ratios, which
  are currency-neutral; FX is applied only for USD display. EUR/GBP need no new machinery. The one
  dollar-threshold test (Graham's size) already returns "not applicable" for non-USD filers.
- **IFRS.** The Japan pool already ingests IFRS filers (`accountingStandard: IFRS`), so the
  line-item model is not US-GAAP-only.
- **ADR de-duplication.** `computeAlmanac({us, adr, homePools:[{country, companies}]})` counts a
  company listed both as an ADR and in its home market once (the home listing). Each new European
  pool de-dups against its own ADRs automatically — already 56 UK, 17 Dutch, 16 Greek ADRs waiting.

## What is genuinely new work, per market

1. **Access** — a fetcher for that country's OAM (or issuer IR pages) to retrieve the ESEF iXBRL
   annual reports. This is the fragmented part.
2. **iXBRL parsing + taxonomy mapping** — extract the tagged IFRS facts and map ESEF/IFRS taxonomy
   concepts to Owner Scorecard's normalized line-item schema. This is the core reusable engine:
   once it parses one ESEF filer, it parses any of them. It is also the hard part (company
   extensions, dimensional tags, presentation quirks) and where accuracy risk lives.
3. **Coverage curation** — pick the large/liquid names per market to respect the asset ceiling.

## Market priority

1. **Italy / Euronext Milan** — the pilot, because a specific name is wanted (Campari) and Milan is
   now part of Euronext (one operator across Milan, Paris, Amsterdam, Brussels, Dublin, Lisbon,
   Oslo — useful once the parser exists).
2. **United Kingdom (LSE)** — the largest European market; UKSEF; the NSM is comparatively
   accessible. High value for the census and for search intent.
3. **Euronext (France, Netherlands, …)** and **Germany (Deutsche Börse)** — big large-cap sets.
4. **Switzerland (SIX)** — note: not EU, so not ESEF; SIX has its own rules. Lower priority.

## The pilot: Campari, then a European large-cap set

**Campari** (Davide Campari-Milano N.V.): incorporated in the Netherlands, listed on Euronext Milan
(ticker CPR), reports in EUR under IFRS, files an ESEF iXBRL annual report published on its IR site
and stored in the OAM. Not reachable today (no US listing, no 20-F). It is a clean first ESEF
target.

Recommended sequence:
1. Build the **ESEF iXBRL parser** and prove it on Campari's annual report — the parser is the
   foundation, not throwaway.
2. Ingest a small **European large-cap set** through it (Campari plus a curated handful), as its own
   pool `fundamentals.eu.json` with a `country` field, `/jp`-style pages (2 files each to save
   assets), de-duped against the ADR pool.
3. Review accuracy against the filings, then scale coverage selectively market by market.

**Effort honesty:** this is a real data-engineering build (a new fetcher + an iXBRL parser + a
taxonomy mapping + tests), not a config change. The parser is the bulk of it and pays for every
market thereafter. Everything downstream — currency, IFRS, de-dup, the pages, the Almanac — already
absorbs a new pool.
