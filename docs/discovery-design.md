# Discovery design brief

docs/discovery-design.md. Merged from three method designs (Graham, Buffett, Munger), 2026-07-09. Doctrine holds throughout: no price feed, no rankings, no scores, no verdicts; companies meet tests or fail them; everything prerendered or client-side on build-time JSON; per-user state only in the existing Supabase follows or localStorage. File and function names below are verified against the repo (`.surplus-scout/ownerscorecard-terminal`).

## 1. The thesis

A screener starts with the whole market and subtracts until a ranked shortlist remains. It needs a price feed, a weighting, and somebody's opinion, and this publication carries none of those. Discovery here is the older practice the library is built on. A reader can read the record straight through, the way Buffett read Moody's page by page, so the obscure entry gets found because every entry gets turned to. A reader can check companies against published tests with the filed figure beside every result, the way Graham ran the Dow through his criteria table, so anything we state can be recomputed by hand. And a reader can start from the disqualifications, the way Munger did, because most inquiries should end in seconds on a cheap check, and a record that cannot be read honestly belongs in a labeled basket, not in a list pretending it was merely unremarkable. The site lays out the record, the tests met and failed, and the case against. The reader brings the two things the site does not have: understanding of the business, and a price. Lists are ordered by the one fact they exist to show, or alphabetically where there is no such fact. The only list that ends in a decision is the reader's own, and it stays private.

## 2. The map

Four public layers plus the reader's own shelf. Every surface lands on a company page; every company page points back out through chips and prev/next links. No orphans.

```
DOORS (ways in)
  /businesses                 ~25 plain-noun shelves: what the businesses do
  /industries/[slug]          chapters: one industry read as a single document
  /manual                     every company in fixed format, A to Z, three volumes
  search                      existing client-side company search, unchanged
  Open anywhere               uniform random door, sitewide and per chapter

TESTS (price-independent, recomputable)
  /archetypes/[lens]          the ten lenses; defensive and net-nets upgraded to workbooks
  /archetypes/enterprising    new: Graham's Ch. 15 second net
  /archetypes/unflagged       new: readable record, no disqualifier fired (never counted by confluence)
  confluence (on /archetypes) 2+ tests, gains a hide-flagged toggle

DISQUALIFICATIONS (cheap checks, named)
  /flags                      hub; five registers, one page per way to die
  /too-hard                   the third basket: unreadable records, each with its reason

THE COMPANY PAGE (the hub: /c/[ticker], /jp/[ticker])
  identity and lede, then the case against, then the record
  chips out to archetypes, flag registers, and its industry chapter
  prev/next in manual order and in industry order
  the gauntlet (client-side walk over the page's build JSON)
  the existing price calculators (reader-supplied price, localStorage)

THE READER'S OWN RECORD (private, never published, never aggregated)
  the punch card              follows as twenty numbered slots (Supabase; localStorage signed out)
  /my/gauntlet                where each walk ended (localStorage, client-rendered)
  bookmarks                   manual position, typed prices, stated kill conditions
```

How the layers relate: the doors are for reading, the workbooks are for checking, the registers are for rejecting. One fixed Entry Block makes the reading surfaces uniform; grids with the filed figure in every cell make the test surfaces recomputable; named registers make rejection specific. Chips are the connective tissue: each archetype chip links to its lens, each flag chip to its register, the industry chip to its chapter. Confluence remains the only surface that counts anything, and it counts tests met, never a rank. New static pages total roughly 215 (manual letter pages, chapters, registers, baskets); the build stays prerendered and the hosting stays $0.

## 3. The features

Sizes: S is about a session, M a few sessions, L a week or more.

### A. Reading surfaces

1. The Entry Block (component, not a page)
Five fixed lines rendered identically wherever a company appears on a reading surface: (1) ticker, name, one-line lede; (2) the ten-year owner-earnings row, ten small figures with an inline shape, no axes; (3) the retained-capital arithmetic as a sentence of numbers (retained X per share over ten years, earnings grew Y); (4) balance-sheet posture (net cash or net debt, lease-adjusted) and stewardship facts (average price paid for buybacks, the dividend record); (5) the archetype chips, alphabetical, never counted into a number. Absence renders blank or "not read," never as a mark against a filled cell. Used on manual pages, industry chapters, and the punch card; not in search results or on archetype lens pages (section 5 explains). Data: existing per-company facts via `capital.mjs` `capitalHistory()`, `fundamentals.mjs` `cashPosition()`, `leases.mjs`, owner earnings, lens membership from `lenses.mjs` `computeLenses()`; lede from `business.mjs` `businessPhrase()` guarded by `weakLede()`, falling back to the shelf noun. Size: M.

2. The Manual (/manual; /manual/us/[letter], /manual/adr/[letter], /manual/japan)
Three volumes (2,671 US, 825 ADR, 34 JP), one page per letter, every company as an Entry Block in strict alphabetical order; the index page lists the volumes and their counts. Company pages gain manual-order prev/next links so reading proceeds page to page. A resume marker in localStorage puts one line on the index: "entry 412 of 3,530, continue at DOV." A bookmark, not a progress bar. Data: the existing company index (`src/pages/company-index.json.js`) plus a build-time sort; ledes as above. Size: L.

3. Industry chapters (/industries/[slug])
One page per industry, roughly 120-150. Top: a short header on the industry's economics; at launch it is computed and factual (member count, median ten-year gross profitability, median capital intensity, how many are net-cash), stated as a description of the list and naming no best member. Hand-written preambles replace computed headers progressively (open question 2). Below: every member A to Z as Entry Blocks with the same columns aligned, so the eye can run down a column. Company pages gain a second prev/next pair scoped to the industry ("next specialty insurer"), and the industry chip links to the chapter. Data: the SIC/industry classification already in the dataset (used today by `peers.mjs` and `business.mjs` `industryLensClause()`), a build-time slug mapping, columns from existing lens facts; the 34 JP companies hand-mapped. Size: L.

4. The shelves (/businesses)
One page, about 25 plain-noun shelves ("They insure things." "They move goods." "They lend money."), each naming its industries with links to the chapters and a company count. A table of contents, not a menu system. No personalization and no prompts; clicking is the circle-of-competence act. Data: a hand-curated mapping file in the repo (industry code to shelf, ~150 rows of JSON); counts computed at build. Size: S.

5. Open anywhere (header link; also on /manual and each chapter)
Sitewide it opens a uniformly random company page; on a chapter, a random member. Uniform, too-hard companies included: any weighting toward test-passers would be an implicit ranking. Data: the existing `company-index.json.js` slug index and a few lines of client-side JS. Size: S.

### B. The test workbooks

6. The Defensive Workbook (upgrade of /archetypes/defensive)
One row per company, one column per price-independent criterion, using the names already in `graham.mjs`: Adequate size, Strong liquidity, Conservative debt, Earnings stability, Dividend record, Earnings growth. Each cell carries the status word and the filed figure ("2.31x", "debt $1.2B vs WC $3.4B", "paid 10 of 10 yrs", "+41%"); statuses are words beside figures, never color-only grades; "na" cells keep their existing explanations ("yours to apply" for non-USD size, "not in the data yet"). Column headers restate the criterion ("Current ratio >= 2x"). The seventh criterion, a moderate price, always renders "yours to apply" and links to the company page's calculator. The wide table scrolls in its own overflow container. A failed cell carries its shortfall in the test's own units: "1.62x, 0.38x short of 2.00x"; "debt exceeds working capital by $1.2B"; "earnings +21%, a third was required."

At top, the group view: "As of the latest filings, N companies meet every testable defensive criterion. As a group: median current ratio X, median debt at Y% of working capital, N with an unbroken dividend, N net-cash." Dated with the filing vintage; the medians are descriptions of the list, never a grade. Contents and order, three strata only: the full-pass group, alphabetical, always in full; then benches of companies failing exactly one test, grouped by which test ("Failing only the dividend test, N companies"), alphabetical within each bench with the shortfall as the row's figure; then a single line, "N further companies fail two or more of the testable criteria; each company page carries its full panel." Never ordered by pass count (section 6 explains). Data: `graham.mjs` `grahamTests()` already returns `{name, criterion, value, status, note}` per test; the shortfall numerics exist today as locals inside it (cr, working capital vs totalDebt, loss count, paid/total, g) and get returned as a numeric delta per test; `computeLenses()` already walks the universe; group medians are a build-time aggregation. Size: M.

7. The Enterprising List (/archetypes/enterprising, new)
Graham's Ch. 15 deliberately relaxed tests for secondary issues as a second workbook: current ratio at least 1.5; debt within 110% of net current assets; no deficit in the last five years; some current dividend; earnings above their level of five years earlier. The price-to-tangible-assets gate renders "yours to apply," like criterion seven above. Header copy names the source and each threshold. Chip rule: a company passing the defensive tests never also wears the enterprising chip; the chip appears only where defensive fails and enterprising clears, and confluence counts at most one of the two. Data: a small new function in `graham.mjs` paralleling `grahamTests()`, built from existing lines (currentAssets, currentLiabilities, totalDebt with the `debtReliable()` guard, netIncome across `company.history`, dividendsPaid); one new entry in the LENSES table in `lenses.mjs`; the pick/figure machinery unchanged. Size: M.

8. The Net-Net Ledger (upgrade of /archetypes/net-nets)
Each row shows NCAV per share plus the as-filed components used to compute it (current assets, total liabilities, diluted shares, filing year), so the subtraction can be redone by hand. Order stays by cushion, the lens's own figure. A client-side price cell per row: the reader types a price, stored only in localStorage, and the row shows price as a percentage of NCAV, with Graham's practice stated in the header: he paid no more than about two-thirds of this figure, and held these in wide diversification, dozens at a time. Typing a price never re-sorts or filters anything. Data: the net-nets `pick()` in `lenses.mjs` already computes NCAV, cushion, and per-share from currentAssets, totalAssets, stockholdersEquity, sharesDiluted; the components get emitted alongside the figure. The price cell reuses the reader-supplied-price pattern from `valuationInputs.mjs` and `reverseDcf.mjs`. Size: M.

9. Tenure (rows on the workbooks; a strip on company pages)
Workbook and net-net rows carry a persistence figure: "met the tests at 7 of the last 9 year-ends." On the company page, a year-by-year strip under the Graham panel marks whether the point-in-time tests (current ratio, debt vs working capital, a profit that year, a dividend that year, NCAV positive) held at each fiscal year-end, with a note that window tests (growth, the stability streak) are defined only over the whole record and are not restated per year. A client-side toggle on the workbook's full-pass group: "held at every recorded year-end." A count of year-ends, never a trend arrow. Data: `company.history` already carries about ten years of statement lines; a new build-time loop applies the point-in-time subset of `grahamTests()` and the net-net arithmetic to each year's lines. No archived builds, no external data. Size: M.

### C. The disqualification surfaces

10. The flag registers (/flags hub, five pages)
One static page per named way to die: restated or admitted a control weakness; serial diluters (share count up despite buyback spend); earnings ahead of cash (corroborated accrual plus Beneish); bought their growth (goodwill at or above book equity, or conceded write-downs); sells hard, steers past GAAP (promotional plus adjusted-figures language). Each row: ticker, name, the single disqualifying fact with its figure ("diluted shares +140% over 9 yrs despite $2.1B spent on buybacks"), linking to the company page. Ordered by the fact's own magnitude using the existing severity sorts, 200-row cap. The red-flag chip on company pages links to the specific register, so every flag is one click from "who else did this." Data: pure decomposition of the red-flags `pick()` in `lenses.mjs`: the integrity restatement and material-weakness reads, `fundamentals.mjs` `forensicScreen()` (mElevated, accrualTC), `capital.mjs` `capitalHistory()` (shareChange, bb), `acquisitions.mjs` `acquisitionRecord()` (exceedsEquity, cumImp), and the candor reads in the langMap passed to `computeLenses()`. One loop plus five prerendered pages. Size: M.

11. The Too-Hard Pile (/too-hard)
Alphabetical, because absence of a read has no magnitude to sort. Each row states the specific reason: record shorter than four readable years; balance sheet incoherent, current assets exceed total assets; ADR ratio unverified, per-share reads withheld; financial company, operating reads are category errors; restatement in progress, prior years unreliable. Member company pages get a plain strip: "Too hard. This record could not be read reliably; these tests were not run:" followed by the withheld reads. Too-hard companies never appear on archetype pages as failing; they appear in their own basket, and in the manual and the chapters, which are reading surfaces, not tests. Data: the withhold paths already coded (the lenses' null-tolerance guards, the short-record checks, the NCAV incoherence checks, the margin withholds, `adrBasis.mjs` warn mode, `freshness.mjs` staleness) currently discard their reasons; collect them into a per-company readability record at build time. Size: M.

12. The Unflagged (/archetypes/unflagged, new)
Membership: at least eight readable years, zero fired red-flag items, zero flagged inversion checks, and not in the too-hard pile. Alphabetical only, deliberately unsortable. Each row: ticker, name, "0 of N disqualifiers fired," years readable. The header states what it is: the pile worth expensive attention because the cheap attention found nothing. Its smallness is the point. Never counted by confluence (section 6 explains). Data: the red-flags lens plus `inversion.mjs` `inversionChecks()` run universe-wide, one extra pass inside the memoized `computeLenses()` build (inversion currently runs only on company pages), plus the readability record from feature 11. Size: M.

13. Confluence toggle (on the existing confluence list on /archetypes)
A client-side toggle, "hide any company with a fired flag," over the caution field the confluence rows already carry. No rebuild. Size: S.

### D. The company page

14. The case against, first (strip on /c/[ticker] and /jp/[ticker])
Position: directly under the identity header (ticker, name, lede) and before segments and prose. The reader must know what a thing is before evidence against it means anything; after that, the disconfirming evidence comes before the story does its seducing. One line per fired item, each with its figure, each anchoring to its full panel below: fired red flags; flagged inversion checks (margin fade, dilution, leverage, conversion, working capital, write-offs); Graham tests failed, stated as n of testable; a candor low if present; withheld reads once the readability record exists. Too-hard companies show the too-hard strip here instead. When nothing fired: "No disqualifier fired on the cheap checks. The two tests that remain, understanding and price, are yours." Never a green badge. Data: a reordering summary over outputs the page build already holds: `inversionChecks()`, red-flags membership, `grahamTests()`, the candor reads. No new computation. Size: S.

15. The gauntlet (client-side on every company page; private record at /my/gauntlet)
"Run the gauntlet" opens a sequence over the page's existing build JSON (`c/[ticker].json.js`), gates in the 2007-letter order, with most walks ending early by design; that is the method working. Gate 0, the case against: every fired flag and inversion check up front, with "the walk usually ends here" when a grave flag (restatement, material weakness) fired. Gate 1, understanding: segments, revenue mix, the business description; the reader marks understand, don't, or too hard. Gate 2, economics: median operating margin through the cycle, ROIC years, gross profitability, the capital-light read, the ten-year table. Gate 3, stewardship: return on each retained dollar, buyback dollars against the share-count trend, the dividend record, the candor read, integrity flags. Gate 4, price, which is yours: the page hands over owner earnings per share, NCAV per share, and the reverse-DCF inputs, and stops; no gate is computed for it. The reader marks each gate and the walk ends where a gate is marked failed. Marks live in localStorage; /my/gauntlet is a static shell, client-rendered from localStorage, listing every company walked and the gate where each died, with dates. Never published, never aggregated. Data: existing reads only: `segments.mjs`, `durability.mjs`, `capital.mjs`, `graham.mjs`, the candor and integrity langMap, `inversion.mjs`, `valuationInputs.mjs`, `reverseDcf.mjs`, stewardship facts. New work is one client component. Size: L.

### E. The reader's own record

16. The punch card (the follows view, today under /account)
Twenty numbered slots in a plain table; filled slots render the Entry Block with the followed-on date as the only metadata. A twenty-first follow gets one plain sentence: "Your card has twenty slots. Choose a company to remove, or keep the card as it is." One epigraph line cites the business-school lecture, so the cap reads as borrowed discipline. No badges, no counters beyond the slots; removal is frictionless. Signed-out readers get the same card in localStorage. Data: the existing Supabase follows (`src/pages/api/follow.js`) with a client-enforced cap; Entry Blocks from the per-company build JSON. Size: M.

17. The before-you-follow card (on follow, and on saving a gauntlet walk)
A small skippable card, three fixed lines drawn from the page's own data: the MD&A's promotional read with its figure and the fact that the writer is paid to sell (or "reads plain, GAAP-faithful"); the gravest fired disqualifier, restated with its figure; and an optional field labeled "your stated kill condition," stored with the follow and shown back on the punch card. A noun-labeled field, not an imposed question. Never scored, never published, never blocking. Data: candor reads and fired flags already on the page; one nullable text column on follows (open question 3) or localStorage. Size: S.

## 4. Build order

Milestone 1: the tests show their arithmetic. Existing computed facts only; no new ingestion, no new test sets. The only lib changes are functions returning numbers they already compute internally.
- Defensive Workbook with shortfalls, group view, and one-test-short benches (6)
- Net-Net Ledger with components and the client price cell (8)
- Flag registers and hub (10)
- The case against, first (14), shipping with flags, inversion, Graham, and candor lines; the withheld-reads line joins in milestone 2
- Confluence hide-flagged toggle (13)
- Open anywhere (5)
Complete on its own: every Graham test shows its filed figure and shortfall, every red flag has a named register, every company page leads with the case against, and a random door exists.

Milestone 2: the library becomes a manual. New build-time derivations (ledes, industry mapping, readability records) and the start of the content work.
- Entry Block component (1)
- The Manual, three volumes, prev/next, resume marker (2)
- Industry chapters with computed headers and industry prev/next (3)
- The shelves (4)
- The Too-Hard Pile (11), here because the manual's claim of completeness requires the unreadable be labeled, not hidden
Complete on its own: a reader can start at the A's and turn every page; every company is reachable through what it does; every unreadable record says why.

Milestone 3: the second net, persistence, and the reader's card.
- The Enterprising List (7)
- Tenure (9)
- The Unflagged (12), which needs the universe inversion pass and the readability record
- The punch card (16)
- The before-you-follow card (17)
- The gauntlet and /my/gauntlet (15)
Complete on its own: both of Graham's nets published; list membership shows its persistence; all three baskets exist (in, out, too tough); the reader's own discipline has a surface, all of it private.

## 5. Not built, and the doctrinal reason

- Ordering by pass count. The Graham design grouped workbook rows by descending passes. A count of tests met, used as an ordering, is a composite score in a plain suit. Strata are named by which tests, then alphabetical. Confluence stays the one counting surface, and it counts membership, not rank.
- The unflagged register counted into confluence. Absence of flags is not a positive test; counting it would mint a virtue score. It stays a basket.
- Entry Blocks in search results. That ships the full fact set in the search index and turns a lookup into a feed. Search stays ticker and name.
- Weighted or featured randomness. Weighting toward test-passers is an implicit ranking. Open anywhere is uniform, too-hard included.
- Progress mechanics on the manual. No percent read, no streaks, no completion states. A bookmark is a ribbon in a book.
- Trend arrows and color-graded cells. Tenure is a count of year-ends; workbook cells are status words beside filed figures. Winner-green against loser-red is winner-highlighting.
- Publishing or aggregating any reader state. No most-followed, no most-walked, no shared gauntlets. The reader's record is the reader's.
- A required reflection prompt. The kill-condition field is optional and noun-labeled; doctrine bans imposed questions, and a mandatory box is a quiz.
- Chapter superlatives. Preambles state industry economics and name no best member; naming one is a verdict.
- Prices anywhere server-side. Typed prices live in localStorage, never re-sort, never filter, never leave the reader's machine. The ledger keeps its cushion order no matter what price is typed.
- Enterprising chips on defensive passers. One net at a time; wearing both would double-count one method in confluence.
- Sort controls on reading surfaces. The manual and the chapters are fixed-format on purpose; the fixed format is what trains the eye, and it keeps every page static.
- A candor score. Language reads stay descriptive figures with the sentences that earned them.

## 6. Conflicts between the three designs, and how they were resolved

- Row format on lens pages. Buffett wanted the Entry Block everywhere, including archetype lists; Graham wanted the defensive page as a criteria grid. Resolved by surface type: reading surfaces (manual, chapters, punch card) use the Entry Block; test surfaces (workbooks, registers) use dense grids whose cells are the point; the other archetype pages keep their one-figure rows, since the lens's own figure is the page's argument.
- Ordering. Buffett wanted A to Z everywhere, Graham grouped by passes, Munger sorted flags by magnitude. Resolved with one rule: a list is ordered by the one fact it exists to show (cushion on net-nets, severity on registers); where there is no such fact, or the surface is for reading, alphabetical. Graham's descending-passes ordering was tightened to named strata because a pass count is a composite.
- Top of the company page. Buffett's method reads the business first; Munger demands disconfirmation first. Resolved: identity and lede first, because filter one requires knowing what the thing is; the case against second; the record and story third.
- The twenty-slot cap against the existing uncapped follows. Adopted, with migration handled in open question 1.
- The gauntlet and the guard against the no-imposed-questions register. Gate titles became nouns (the case against; understanding; economics; stewardship; price, which is yours), and the follow-time reflection became an optional noun-labeled field.
- Munger's register at /archetypes/unflagged against confluence semantics. The route is kept, since it reuses the lens machinery, but it is excluded from confluence counting.
- Buffett's hand-written industry preambles against shipping complete milestones. Chapters launch with computed factual headers; hand-written preambles are an editorial series that replaces them progressively.

## 7. Open questions for the owner

1. The punch-card cap and existing follows. Some readers may already follow more than twenty. Recommendation: enforce the cap on new follows; render existing overflow in a plain list under the card, labeled "beyond the card," until the reader trims it. No forced removal.
2. Industry preambles. Hand-writing roughly 120 chapter preambles is a real editorial commitment in the publication's voice. Recommendation: ship computed factual headers everywhere; hand-write the twenty largest chapters first, through the usual doctrine loop, and let the rest follow as a series.
3. Where the kill condition lives. A Supabase column syncs across devices and sits beside the follow it belongs to; localStorage never leaves the machine. Recommendation: one nullable text column on follows; it is the reader's own words, already private, and the table exists.
4. The public noun "Manual." It is the honest borrowed form, but the word can read as instructions. Recommendation: keep Manual, with one line on /manual naming the borrowed form; the volumes and entries make the meaning obvious in one click.
5. Lede quality. Build-time extraction (businessPhrase with the weakLede guard) will misfire on some filings. Recommendation: accept the heuristic, fall back to the shelf noun where it fails, and hand-correct only the entries the manual pages make visibly wrong.
6. Volume split. Separate US, ADR, and Japan volumes match the Moody's practice and keep ADR ratio caveats clustered; a single merged alphabet is one book. Recommendation: separate volumes, all three visible from the manual index.
7. Register caps. The 200-row cap is kept on flag registers; on the Defensive Workbook the full-pass group and the one-test-short benches always render in full, with the two-or-more-failures remainder as a count. Recommendation: keep, and revisit only if a full-pass group ever approaches the cap.
