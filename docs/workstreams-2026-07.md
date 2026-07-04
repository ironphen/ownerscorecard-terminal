# The Two Workstreams — research findings, July 2026

Research context, not legal advice. Case claims below were adversarially fact-checked (July 2026);
confirm with a securities attorney before charging money.

## WS1a — Disclosure and adviser status

**Where the publication stands.** The Advisers Act excludes "the publisher of any bona fide
newspaper, news magazine or business or financial publication of general and regular circulation"
(§202(a)(11)(D)). *Lowe v. SEC*, 472 U.S. 181 (1985) applied that exclusion to paid subscription
newsletters that carried explicit buy/sell recommendations; a publication that recommends nothing
sits further inside the exclusion than the conduct *Lowe* itself protected. A 2024 S.D.N.Y.
decision dismissed a class action against Seeking Alpha's paid platform on the same exclusion
(paid tiers, breaking-news cadence, and subscriber filtering all held compatible with it — though
it is one district-court ruling, dismissed with leave to amend). While the site is free there is
an independent shield: no advice "for compensation." The exclusion becomes load-bearing only at
the first paid dollar.

**Why disclosure still matters.** Rule 10b-5 reaches publishers who are not advisers. *SEC v.
Park* ("Tokyo Joe," N.D. Ill. 2000) let a scalping theory proceed against a stock-pick site
operator (the court also found him plausibly an adviser); Andrew Left (Citron) — a pure
publisher — was convicted by a federal jury in June 2026 (13 counts; acquitted on 4; on appeal)
for stating price targets and holding intentions while trading the other way. The convicting
conduct is precisely what the doctrine already forbids: stated targets, stated intentions,
trading against one's own published position. The doctrine is the first line of defense;
disclosure is the second.

**The policy to adopt (before the origin letter debuts it):**
1. **Ownership & Independence page**, footer-linked sitewide: no compensation from covered
   companies or promoters ever (the §17(b) prophylactic); the writer owns common stocks
   personally, outside the business, possibly including covered names; the trading rule, stated
   publicly; no personalized advice, ever (this sentence also fences the exclusion's
   individualized-advice prong).
2. **Per-Note disclosure line**: "The writer owns shares of [Company] and has owned them since
   [year]. This publication does not recommend securities. Positions are stated as of the
   publication date and may change; changes will not be announced." (The last clause forecloses
   any implied duty to update.) Where none: "The writer owns no position in any company
   discussed."
3. **Trading rule**: no trades in a covered name from 5 trading days before a Note through 10
   after; never publish on a position intended to be exited within the quarter; never state a
   price target, holding intention, or forecast of own behavior; keep a dated log of trades and
   publication dates (the contemporaneous log is the whole defense).
4. **At the first paid dollar**: lawyer confirms the state blue-sky publisher exclusion (domicile
   + large subscriber states); no personalized replies to paying subscribers about their
   situations; auto-renewal/negative-option statutes; subscription marketing may never tout
   performance (already decided independently: personal returns are never published).

## WS1b — The road to ~$400/yr, staged and gated

**Comparables (fetched July 2026).** Doomberg $400/yr annual-first (~380k free, tens of
thousands paid); The Bear Cave $640/yr, ~1,300 paid of ~87k free ≈ **1.5% conversion**; Value
Line ~$598 retail; Grant's Interest Rate Observer **$1,950/yr with no performance marketing and
no verdicts** — proof the lens-not-verdicts product sells at a premium. Common traits of the
$300–600 survivors: relentless calendared cadence; a huge never-paywalled free layer (the wire
is ours); a distinctive lens; annual-first; price raises after proof.

**Conversion realism.** Plan on 1–3% of the *engaged email list* (not pageviews) at this price
point. 100 paid at $400 = $40k ARR needs roughly 3,300–10,000 engaged subscribers. The
founding-member launch converts a smaller, hotter list in a burst.

**The stages.** (Build nothing commercial before its gate.)
- **Stage 1 — prove the pen:** Notes on a fixed, kept cadence (1–2/month). Gate: 8–12 Notes on
  schedule, 1,000+ wire subscribers, real engagement, first answer-engine/search citations of
  Notes. Build: nothing new.
- **Stage 2 — prove the pull:** same cadence. Gate: 2,500–3,000 engaged subscribers and
  third-party pull (3+ unsolicited citations/links of Notes). Build: nothing new.
- **Stage 3 — founding presale, the kill-gate:** $200–300 founding annual (grandfathered),
  60–90 day window, one Stripe payment link, full refund if the tier never launches. Gate:
  **25–50 prepays; under 25 = stop and rethink** — the audience reads but won't pay.
  Deferred revenue → refund reserve + T-bills/MMF per the phase-2 plan.
- **Stage 4 — first recurring dollar:** $400 annual-first; wire stays free (funnel), deep Notes
  go paid (product), record pages free forever (moat). Raise price only after retention proof.

**Honest pressure point:** every survivor has a named voice or persona; the publication-identity
byline means the brand entity must do the persona's work. That likely lengthens Stages 1–2, and
the kill-gate tests exactly this.

## WS2 — Product wins that would make Graham, Buffett, and Munger daily users

Panel finding: much already exists (Graham's defensive tests run per company, NCAV, buyback
average-price-paid, return-on-retained, a real Inversion section). The ranked residue:

1. **"New this year, in the company's own words"** — `language.json` already carries per-company
   `mdnaChange`/`riskChange` and nothing renders them. A section beside OwnersRead makes every
   page the filing-diff Buffett reads by hand. Effort S; data already paid for.
2. **Complete Graham's price gates in "What the price implies"** — earnings yield vs. 2× the
   10-yr Treasury (rates.json is already imported into Valuation.astro) and price vs. NCAV where
   positive, framed exactly like the shipped P/E-15×P/B-22.5 gate: clears his published test or
   does not, never "cheap." Effort S.
3. **The filing shelf** — per-year 10-K/proxy links on the ten-year record (EDGAR submissions
   JSON already carries accessions); "every figure traced to the filing" currently resolves only
   to the latest one. Effort S/M.
4. **"Paid on what?"** — the proxy's named incentive metrics, verbatim, one row in Management &
   pay ("bonus vests on adjusted EPS; LTI on relative TSR"). Munger's show-me-the-incentive,
   currently unanswered. Effort M (parser + qualitative-doctrine governance).
5. **Candor drift inside Inversion** — `candor` vs `candorPrior` (both already collected): did
   the talk get more promotional as results softened? Effort S.
6. **Archetype list export (CSV)** — Graham's mechanical sieve carried to the reader's own
   worksheet; the verdict happens off-site. Effort S.
7. **Wire "your companies" toggle** — client-side filter to followed tickers on /wire. Effort S.
8. **Private reader notebook** — one private note per company per reader (follows pattern
   copied; RLS). The site stores a reader's verdict, never utters one. Effort M; strongest
   retention asset for the eventual paid tier.
9. **Company-page print polish.** Effort S.

**Not to be built:** any universe-sortable Graham score or composite ranking (a sortable column
of "tests met" across the universe is a ranking = a verdict); screener-with-price; ordinal
anything across companies.

Doctrine line, settled by the panel: *company-first* quantitative work (the reader chose the
name; run the published tests on it) is inside doctrine. *Universe-first* filtering to a buy
list is not. Archetype membership stays safe because it is a fact about a named, published test.
