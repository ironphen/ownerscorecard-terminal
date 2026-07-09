# Valuation doctrine review: the reference value

Audited and recommended 2026-07-09 (wf_2be92e94). STATUS: the default-render exposure is
HOTFIXED as of this commit (every reference-value dollar now renders only after the reader
types a price, in all four modes and on /compare); the fuller redesign below awaits the
owner's sign-off.

## The audit finding

YES — a dollars-per-share "Reference value / share" AND a "…less a 30% margin of safety" dollar figure render on page load, before the reader types anything or moves any dial, in ALL FOUR modes of Valuation.astro. Evidence:

OWNER-EARNINGS MODE (the common case): the markup ships hidden (`<div class="compare ref" id="refRow" hidden>` Valuation.astro:475) but the load-time `update()` call (line 868) unhides and fills it BEFORE the price gate: the refRow block at lines 776–787 runs ahead of `const price = parseFloat(px.value); if (!(price > 0))` at 789–790. Condition needs no price: `!isNaN(GDELIV) && GDELIV >= -0.05 && GDELIV <= 0.30 && base > 0 && SH > 0 && rr > gT` (777). Then `refV.textContent = SYM + refPx.toFixed(2)` (783) and `refMos.textContent = SYM + (refPx * 0.7).toFixed(2)` (784), where `refPx = (mult * base - NETDEBT) / SH` (779). Rendered labels: "On the growth it delivered" (476), "Justified multiple" (477), "Reference value / share" in the accent "hot" class (478), "…less a 30% margin of safety" (479). Default assumptions are the slider ship values: discount rate 9% (`value="9"`, 509), years of high growth 10 (510), terminal growth 2.5% (511); growth is the record's delivered CAGR (data-gdeliv, 412), base is latest-year owner earnings. Also default-rendered: "Base in use: $X · $Y.YY/share" (770) and the full sensitivity grid of justified multiples (renderSens called at 785, only inside this no-price branch). So a reader landing cold on e.g. /c/KO sees "Reference value / share $58.31 / …less a 30% margin of safety $40.82" (illustrative) computed entirely from site-chosen defaults.

BANK/INSURER MODE: refVB/refMosB depend "only on the dials and the normalized return, not on the price you type" (comment 955–956); filled at load (`update()` at 982) via `refVB.textContent = SYM + refValue.toFixed(2); refMosB.textContent = SYM + (refValue * 0.7).toFixed(2)` (961). Defaults: cost of equity 10% (364), long-term growth 3% (365). The ref-row markup (353–356) has no hidden attribute at all.

REIT MODE: same pattern, comment "the reference value depend only on the dials, not the price" (1004), filled at load (1030) at lines 1008–1009. Defaults: discount 8% (332), FFO growth = delivered FFO CAGR clamped 0–8% (333, computed at 188). Markup 326–329, never hidden.

NEGATIVE-OE MODE: refVN/refMosN filled at load (930) at lines 903–908 from revenue grown at the delivered rate, a Gordon multiple, and a "mature owner-earnings margin" the SITE prefills at 15% (`value="15"`, 404) — the reader's "margin you would believe" is defaulted by the publication. Defaults: discount 9% (400), 10 years (401), revenue growth = delivered clamped (402/201). Markup 393–397, never hidden.

COMPARE VIEW: the "Reference value / share" cell fills the moment a ticker column is added, with no price typed — in priceRead() the reference computation (compare/index.astro:302–304 owner-earnings, 314–315 bank with hardcoded g=0.03 at 312, 320–321 REIT) carries no `price > 0` guard; only the "implies" cell does (306, 316, 322). Default required return 9% (`let rate = 9` at 221; slider value="9" at 51), N=10, gT=2.5% hardcoded (287).

## Surfaces

1) /c/[ticker] company page — Valuation.astro rendered at src/pages/c/[ticker].astro:221 (#sec-price). Four modes, all showing "Reference value / share" + "…less a 30% margin of safety" in dollars (or local currency / USD-per-ADS): owner-earnings (Valuation.astro:475–480, JS 776–787), bank/insurer (353–356, JS 957–962), REIT (326–329, JS 1007–1010), negative-OE (393–397, JS 903–908). Plus, same section: "Base in use: $X · $Y.YY/share" (770), the sensitivity grid "What the record justifies: the owner-earnings multiple, across the dials" (515–519, 687–702), the "Justified multiple"/"Justified by growth"/"Justified by the return" readouts (477, 323, 350), Graham's price gate "Clears / Above his line" (487, JS 809–812, price-gated), the bond-yardstick comparison (493–505, price-gated), the ops picture / implied market cap (466–473, price-gated), and lede verdict sentences in bank/REIT modes ("below/in line with/above the about N× that … would support", 974–976, 1021–1023, price-gated). 2) /jp/[ticker] — identical component at src/pages/jp/[ticker].astro:119; same exposure in yen with the 10-year JGB anchor (Valuation.astro:273–276). 3) /compare — "The price: what you'd have to believe" band, row "Reference value / share" with rsub "a yardstick, never a target" (compare/index.astro:417), filled per column without a typed price (302–304, 314–315, 320–321); state lives in the URL so a shared/screenshotted comparison carries up to four side-by-side reference values. Footer disclaimer at 75–83. 4) /compare/[ticker].json (built from src/lib/compareCard.mjs via valuationModel in src/lib/valuationInputs.mjs) — carries reverse-DCF INPUTS only (oe, oeNormalized, oeMaint, gDeliv, netDebt, shares, eps3, bvps; tbvps/rotce for banks; ffops for REITs; compareCard.mjs:164–178) — no precomputed reference value; the gDeliv anchor is derived at valuationInputs.mjs:85–88. 5) /c/[ticker].json machine endpoint — records only; header comment "and NOTHING derived… this publication does not rate" and provenance note "This endpoint carries no ratings, estimates, or derived judgments by design" (src/pages/c/[ticker].json.js:1–5, ~40). No reference value there, nor in llms.txt.js. 6) URL params ?px= and ?by= carry only reader-supplied price/bond yield (Valuation.astro:721, 856–867) — but the reference value renders even on a bare URL with no params.

---

# Reverse-DCF: remove the reference value, keep the reverse, add the ladder and the base rates

## 1. Verdict

Your concern is warranted and the audit shows it is worse than the wording of the concern: the reference value does not wait for the reader. It renders in dollars per share on page load, in all four modes of `src/components/Valuation.astro` (and on /jp in yen), from assumptions the publication chose (9% discount, 10 years, 2.5% terminal; 10% and 3% for banks; 8% for REITs; a site-prefilled 15% "margin you would believe" in the negative mode), and /compare fills the same row for up to four tickers with nothing typed, under a band headed "The price," in a shareable URL. The "…less a 30% margin of safety" line then discounts our own figure into a functional buy-below price, so a cold screenshot reads as a fair-value estimate plus an entry price under the OwnerScorecard masthead, and the tool's true defense, that the reader brings the price, is unavailable for exactly this row because the reader brought nothing.

## 2. Remove / Keep / Change

### REMOVE (one decision, five surfaces)

- The "Reference value / share" row and the "…less a 30% margin of safety" row in all four modes: `refRow`/`refV`/`refMos` (Valuation.astro ~475-480, ~773-787), `refVB`/`refMosB` (bank, ~353-356, ~957-961), `refVR`/`refMosR` (REIT, ~326-329, ~1007-1010), `refVN`/`refMosN` (negative, ~393-397, ~903-908), plus the foot-text sentences that explain them.
- The "Reference value / share" row in /compare (`compare/index.astro:417`, fill logic 302-304, 314-315, 320-321), including the "a yardstick, never a target" subtext. A disclaimer of that shape is what a hostile reader quotes as the admission. Removing this row also removes the hardcoded 3% bank growth (line 312) that no reader could see or move.
- The site-supplied 15% prefill on the negative mode's "margin you would believe" dial (line 404). Ship it empty; that comparison renders only after the reader states a belief. The reader's belief must be the reader's.

Little is actually lost. The information survives as justified multiple times the per-share base (one multiplication, the reader's act), and the implied-vs-delivered growth read carries the identical judgment in growth terms. The only thing deleted is the pre-multiplied dollar, which is precisely the part that was ours.

### KEEP (untouched, the spine)

- The reverse read: typed price in, implied growth out, beside the delivered growth. `solve()` already runs only when price > 0. This is the product.
- Reader-supplied price and bond yield living only in the reader's URL; no price feed; reader-supplied share counts where missing.
- Graham's price gate (15x / 22.5 product) and the bond yardstick, both price-gated, with the dated public-domain yield.
- Ops picture, implied market cap, required-margin reads, all price-gated.
- Delivered-growth anchors, sparklines, and "Base in use" per-share figures (filed-record facts).
- Both JSON endpoints exactly as they are. They are already perfect ("no ratings, estimates, or derived judgments by design"); these changes bring the HTML pages up to the standard the endpoints set.

### CHANGE (three, all small)

1. Margin of safety becomes a growth cushion (option 8, strict variant). After a price is typed, one line: "A third below your price, the implied growth falls to Y%/yr, against Z%/yr delivered." No second dollar printed anywhere. This puts margin of safety back where Graham put it, a discipline the buyer applies to their own price, not a discount we apply to our own estimate.
2. The sensitivity grid becomes the centerpiece schedule (option 5). Growth rows (0%, 5%, the delivered rate labeled as the record, 15%, 20%) by discount columns; cells are justified multiples; retitle away from the worth-verb ("What the record justifies" becomes something like "What a growth belief costs, in multiples"); fold the standalone "Justified multiple / On the growth it delivered" point into the grid's delivered-growth row so the page never singles out one multiple as the company's number; once a price is typed, locate the reader's paid multiple in the surface. Hard rule: no cell is ever highlighted as fair.
3. Bank/REIT lede sentences drop the in-house 0.85/1.15 tri-band ("below / roughly in line / above"). State both multiples plainly, the multiple the typed price is and the multiple the formula supports at the reader's dials, and let the reader see which is larger. The banding is our adjective; the two numbers are arithmetic.

## 3. Additions (the usefulness dividend)

1. **Base rates against the requirement** (option 7). After "the price implies X%/yr for N years," append the counted frequency from the record already in memory (`oeAbsHist`): "Across its filed record, NAME grew owner earnings above X%/yr in 3 of its 14 rolling five-year windows." Symmetric whether flattering or damning, no adjectives, gated on 8+ year records. Highest new-information-per-pixel available: the implied rate already exists; this tells the reader how often the business's own history met it.
2. **The implied-growth ladder** (option 3). Price-gated table: required-return rungs (6/8/10/12%) by implied growth at the typed price, with delivered growth as a labeled marker line. It answers the reader's actual daily question, what must I believe to earn X% from here, at every rung at once; the reader who finds the crossing has derived their own expected return without the page ever stating one. Never auto-highlight the crossing rung.

Together these make the tool strictly more useful than the row being deleted. The reference value answered a question the publication must not answer (what is it worth on our defaults). These answer the reader's questions in pure reverse: what does my price require, how often has this business delivered that, what does my belief buy.

## 4. The doctrine argument (as it would be given to a hostile reader)

A price target is a dollar figure the author asserts for a named security today, standing on its own, requiring nothing of the reader. After this change the page contains no such figure. The test applied to every number is plain: could it exist without an act of the reader's? The record can. It comes from the filings, and a filed record is nobody's opinion. The schedule can. It is general arithmetic, true of any business at the stated growth and rate, the same kind of table Graham printed with a warning fastened to it, and it wears its assumptions in the row and column labels where they cannot hide. Every dollar is different. A dollar exists only after the reader types a price, is arithmetic on that price, and changes when the price does. The page publishes no value for the reader to compare against. The reader brings the price, and the record answers.

Buffett gives the reason in the Owner's Manual. Intrinsic value is an estimate rather than a precise figure, two people looking at the same facts will almost inevitably come up with different figures, and that is one reason Berkshire never gives its owners an estimate of intrinsic value. What it gives them instead is the per-share inputs and room to do their own arithmetic. This page does the same. A reader may multiply the record by the schedule and arrive at a dollar figure, and the figure will be theirs, made from assumptions that were visible when they chose them. That is not a gap in the discipline. That is the discipline.

## 5. Build plan

| Order | Change | Size | Notes |
|---|---|---|---|
| PR 1 | All removals (four modes, /compare row, foot-text), MoS growth-cushion line, empty the negative-mode margin prefill, tri-band rewording | M (1-2 days) | Ship first, nothing waits on it. After this PR no derived dollar exists anywhere without a typed price; the only default dollars left are filed-record facts. Verify /c, /jp, /compare and the compare-card build; grep for `refV`/`refMos` ids to catch strays. |
| PR 2 | Grid reshape, retitle, fold the justified-multiple point into the schedule, paid-multiple locator | M (~2 days) | Clears the last borderline default render (the "justifies" verb and the single company-keyed multiple). |
| PR 3 | Implied-growth ladder | M (2-3 days) | Fills the hole the reference value leaves, in pure reverse. |
| PR 4 | Base-rate window counts | S (1-2 days) | Purely additive; honesty gate for short and turnaround records. |

Roughly a week and a half total, sequenced so the exposure dies in the first PR. Unscheduled but not foreclosed: the Graham-tests strip with payback-in-owner-earnings-years (option 4); good, and it can wait.

## 6. Open questions for you

1. **Should the multiples schedule render before any reader act, or should everything derived wait for a first touch (option 2 in full)?** My recommendation: serve the schedule. It is Graham's category of publication, formulas and tests anyone may apply to anything, with the assumptions worn on the labels, and gating it costs the pre-price teaching value while buying little once no dollar renders untouched. If you want the absolutist posture instead, the touch-gate is a two-hour add on top of PR 2. Either answer keeps every dollar price-gated.
2. **The reader's private ledger (option 6), now or later?** My recommendation: later, after these four PRs prove out. When built: opt-in, localStorage only, clear-all control, and the "Nothing is stored" copy amended the same day to "stored only on this device, only if you ask." Supabase sync waits for the subscriber phase and gets the trade-log treatment, private by construction, with copy that names whose numbers they are.
