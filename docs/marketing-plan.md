# The marketing doctrine, and the build list

2026-07-10. The owner's directive: value-adding marketing/social strategies "aligned with what
Warren Buffett would do in my shoes," executed while the Notes are hand-written. This document
is the doctrine and the ranked build list; the X drafter (marketing/README.md) was the first
piece.

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
| 1 | X filings drafter + phone notifier | News-pegged, factual, daily; the publication's public pulse | SHIPPED (deterministic, in wire.yml) |
| 2 | Per-company link previews (OG images) | Every link shared anywhere becomes the product's face: ticker, name, the record at a glance. The highest-traffic surface we don't control today is other people's feeds | BUILDING |
| 3 | Answer-engine legibility (llms.txt depth, endpoint docs page) | The tinkerer hook and the AI-citation hook are the same artifact: documented, stable, attributable data endpoints | BUILDING |
| 4 | Weekly "the week on the wire" thread draft | The digest artifact; one thread that summarizes what companies filed, figures verbatim | SHIPPED (Monday branch of the drafter) |
| 5 | Wire email loop polish (forward hook, public day-permalinks) | The only owned push channel; forwarding is the only viral mechanic doctrine allows | queued |
| 6 | The build-story page (how one person + AI built a free Value Line) | The one launch-day artifact (HN et al.); owned-methods posture makes it tellable | waits for the owner's voice; drafts only on his word |
| 7 | Community presence (value-investing forums) | Human, manual, the owner's own hand — never automated | owner's judgment, not a build |

Cost discipline: everything above runs at $0/month (worker-rendered images, static docs,
deterministic drafts). Auto-posting to X is rejected: the API tier costs real money and removes
the human from the publication's public voice.
