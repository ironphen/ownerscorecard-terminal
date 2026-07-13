# The marketing doctrine, and the build list

2026-07-10. The owner's directive: value-adding marketing/social strategies "aligned with what
Warren Buffett would do in my shoes," executed while the Notes are hand-written. This document
is the doctrine and the ranked build list.

**RETIRED (2026-07-13): the X drafter and its notifier.** The owner's verdict: "the tweet
drafter is too manual for me to keep up with and doesnt add value." The lesson stands as a
constraint on everything below: any channel that needs a daily human act to function is a
channel this publication does not run. Marketing here must be INFRASTRUCTURE — built once,
maintained by the same workflows that maintain the data, earning citation while unattended.
Removed: scripts/draftTweets.mjs, the wire.yml step, marketing/ (queue, log, README), and the
12:45 UTC phone-notifier routine. The doctrine's anti-goals were never violated and survive
unchanged; X remains available to the owner's own hand whenever he wants it, with no machinery
underneath it.

## The doctrine: earn citation, never buy attention

Buffett never advertised. The letter WAS the marketing; the record WAS the pitch; the teaching
WAS the funnel; and scarcity of voice — a few excellent artifacts, repeated never — built the
trust that promotional volume spends. Graham's channel was the same: he taught (lectures that
became Security Analysis, a column, The Intelligent Investor), and the teaching outlived him.
Applied here:

1. **The Notes are the engine.** Everything else points at them and at the record. No growth
   work may delay or dilute them.
2. **Every artifact must be worth citing.** A tweet is a filing fact with its figure; a link
   preview is the company's record at a glance; an email is the day's filings. If an artifact
   would embarrass the masthead printed on a research note, it doesn't ship.
3. **Permanent URLs are citation equity.** Nothing that has been linked ever 404s (the
   _redirects file is marketing infrastructure).
4. **Teach in public.** The concepts pages, the Manual's borrowed form, the tests with their
   arithmetic showing — these are the "annual meeting" layer: free teaching that compounds.
5. **The machines are an audience now.** Answer engines cite primary-source, well-structured,
   honestly-dated pages. OSC's whole design (records, provenance, llms.txt, JSON endpoints) is
   the AEO strategy; the work is making it legible, not making it loud.
6. **Anti-goals, permanent:** no paid ads, no engagement bait, no hot takes, no hashtags, no
   follower-count tactics, no auto-posting without a human, no announcing positions, nothing
   that spends trust to buy reach.

## The build list, ranked by leverage

| # | Piece | Why it compounds | Status |
|---|---|---|---|
| 1 | X filings drafter + phone notifier | (retired — required a daily human act; see header) | RETIRED 2026-07-13 |
| 2 | Per-company link previews (OG images) | Every link shared anywhere becomes the product's face: ticker, name, the record at a glance | SHIPPED |
| 3 | Answer-engine legibility (llms.txt depth, endpoint docs page) | The tinkerer hook and the AI-citation hook are the same artifact: documented, stable, attributable data endpoints | SHIPPED |
| 4 | Weekly "the week on the wire" thread draft | (retired with the drafter) | RETIRED 2026-07-13 |
| 5 | Wire email loop polish (forward hook, public day-permalinks) | The only owned push channel; forwarding is the only viral mechanic doctrine allows | queued |
| 6 | The build-story page (how one person + AI built a free Value Line) | The one launch-day artifact (HN et al.); owned-methods posture makes it tellable | waits for the owner's voice; drafts only on his word |
| 7 | Community presence (value-investing forums) | Human, manual, the owner's own hand — never automated | owner's judgment, not a build |

## The zero-maintenance replacements (2026-07-13, after the drafter's retirement)

A five-lens design pass (27 proposals, cross-lens convergence standing in for the adversarial
verify a credit outage cut short) produced the infrastructure below. Everything here is
maintained by the same daily workflows that maintain the data — no channel needs a recurring
human act.

**SHIPPED (Tier 1 — machine legibility):**
1. **Filing Wire Atom feed** (`/wire.xml`, `src/lib/wireFeed.mjs`) — the site's daily-changing
   stream, machine-subscribable at last: one entry per filing, id = the SEC accession number
   scoped by ticker (co-filers share an accession, so ticker-scoping keeps ids unique), dates =
   the filing's own date. Autodiscovery on every page; `rel=self` added to the notes RSS;
   listed in llms.txt and /docs/data. Guarded by `scripts/wireFeedTest.mjs`.
2. **Dataset + DataCatalog + trust graph** (`src/lib/seo.mjs`) — every `/c` and `/jp` page now
   emits a schema.org `Dataset` (free, licensed to the site's own terms — NOT CC-BY, since
   attribution is requested not required — with the JSON twin as its distribution), a
   `Corporation` anchored to its SEC EDGAR CIK, and a `BreadcrumbList`. `/docs/data` is a
   `DataCatalog`. The Organization carries `publishingPrinciples`/`correctionsPolicy`/
   `ownershipFundingInfo`. The 826 `/jp` pages, previously emitting nothing, are closed (EDINET
   as their source, `/compare` card as their twin). No founder Person node: the masthead is the
   byline, by the authorship doctrine. Guarded by `scripts/seoTest.mjs`.
3. **CORS on the public data endpoints** (`public/_headers`) — the "free, no key, meant to be
   fetched" JSON and feeds are now fetchable from any origin (were browser-unreachable).
4. **IndexNow** (`scripts/pingIndexNow.mjs` + wire.yml step) — the daily wire push now tells
   Bing/Yandex/Naver/Seznam/Yep exactly which pages changed, after a live-deploy check, fully
   fail-soft. Placed ONLY in wire.yml, where the changed set is small and known each day;
   deliberately NOT in the bulk fundamentals workflows (submitting thousands of URLs misuses the
   protocol — the honest sitemap lastmod is the right signal there, and it also covers Google,
   which ignores IndexNow). Key: `public/e7cd0f0ed2ac86316a7ebe33de3fde94.txt`.

**QUEUED (Tier 2 — reader-sharing mechanics):** wire day-permalinks (`/wire/YYYY-MM-DD` +
per-day OG card + permalinked email footer); copy-table-as-citation and deep-link row anchors
(the FRED pattern); print-to-PDF exhibit hardening (the Value Line photocopy physics).

**ONE-TIME HUMAN ACTS (handed to the owner, the single sanctioned sitting):** Google Search
Console + Bing Webmaster Tools enrollment (one DNS TXT, submit the sitemap and /wire.xml, confirm
the IndexNow key; also a free passive alarm on deploy breakage); directory listings under his
GitHub identity (public-apis, awesome-quant, AlternativeTo); optional Internet Archive S3 keys
for automated Wayback preservation.

**NOT DOING (with reasons):** per-company feeds (3,530 files, median company files <1×/month —
audience ≈ zero); Wikipedia/Wikidata self-creation (COI, fails notability with no third-party
refs, risks the domain on the spam blacklist — citation must arrive from editors); JSON Feed
(every consumer also reads Atom); FAQPage/HowTo/Review markup (imposed questions / verges on
advice / is a rating — the doctrine lines that removed the too-hard pile and the case-against);
`/embed` tables (the one proposal with real doctrine tension — an embedder can frame the verbatim
table inside their own verdict; flagged for the owner's call, not shipped).

Cost discipline: everything above runs at $0/month (worker-rendered images, static docs,
deterministic drafts). Auto-posting to X is rejected: the API tier costs real money and removes
the human from the publication's public voice.
