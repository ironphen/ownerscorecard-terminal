# Owner Scorecard — Working Handoff

> Continuity doc for a context refresh. Read this first. Branch: `claude/jolly-ride-nae81r`.
> `main`/live is only at the coverage-expansion merge; **everything below is branch-only, not live.**

## The spirit (carry this forward)
We're building the canonical **free** place serious fundamental investors send beginners to learn
to *read a business* the way Graham, Buffett and Munger actually do — a modern, honest replacement
for Value Line, but free, deterministic, and with no verdicts. The founder is a devoted value
investor turned away by the traditional Wall Street routes, building this with a chip on the
shoulder and a vision to help people for nothing. That outsider streak is *fitting* — value
investing's whole founding myth is the establishment being wrong about price and about people.
The standard we hold, every commit: **prove it before you push it; ship nothing sloppy; leave
data blank rather than fake it.** Restraint is the product. Steady hand. We're genuinely making
something good.

## Hard constraints (non-negotiable)
- **$0 total cost. No LLM in the pipeline** — deterministic regex/NLP only, all at build time/CI.
  No runtime API/DB.
- **"Present, never pronounce"** — no scores/grades/verdicts. Surface the signal + the verbatim
  evidence or the figure; the reader judges.
- US and JP are **separate pools** (JP via EDINET, never through the US SIC/archetype engine).
- Develop on `claude/jolly-ride-nae81r`. **Never push to `main` without explicit permission.**
  Don't open PRs unless asked. Personal trading record is never published.
- **Push discipline:** never push code while a CI data-fetch is running (push race). Commit FIRST,
  then `git pull --rebase`, then push. Commit as `Claude <noreply@anthropic.com>` with trailers:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_013UFmHVtesZ34bMojnBg9NB`.
  Never put the model identifier in commits/PRs/code.

## Where things stand
**Merged to `main` (live-eligible):** US coverage expanded to the Nasdaq top ~3,000 by market cap
(~2,626 render-ready after the per-company quality gate); self-maintaining schedule (fundamentals
weekly, filings+segments+universe-rebuild monthly).

**On the branch, verified, NOT merged:**
- Record → **Value Line-style 3-statement snapshot** (`TenYear.astro`): Income statement / Cash flow
  & returns / Balance sheet bands, with M&A + cost rows. Specialized records (bank/insurer/REIT/
  managed-care/asset-manager) deepened.
- M&A + cost pipeline (`fetchFundamentals.mjs`): `goodwillImpairment`, `assetImpairment`,
  `acquisitionSpend`, `sgaExpense`, `researchDevelopment`; `effectiveTaxRate` + `costStack` helpers
  (`fundamentals.mjs`). Audit floors recalibrated for the broad universe (`auditData.mjs`).
- **Japan**: revenue corrected (standard-aware IFRS-vs-J-GAAP pick), SG&A/goodwill/R&D added.
  Settled on the honest **5-year baseline** — 10-year deep history is NOT reliably available from
  EDINET for the big IFRS-transition conglomerates (Toyota/Sony pre-transition years are parent-only
  in the elements we parse), and forcing it regressed clean names. `deepenHistory` was removed.
  Every figure shown is the real consolidated number; Toyota/Sony show ~2 recent years (blank, not
  wrong, before that). Don't re-attempt depth without per-company tag work.
- **CMG large-split fix**: `SPLIT_RATIOS` in `capital.mjs` now reaches 50× (Chipotle's 50:1 read as
  +4273% dilution; now −12.5%). Fixes any large-split name.
- **Qualitative NLP** (`fetchFilings.mjs`): Overview-preferred lede; **Candor Read** (`candorSignals`:
  owner/promo/adjusted densities + verbatim mistake-admissions); **business-in-brief** (`businessBrief`:
  2–3 substance sentences); **serial "one-time" charge** Munger test (`inversion.mjs`, no re-fetch).
- **The Buffett read** (`buffettRead` in `fetchFilings.mjs`; tested in `buffettReadTest.mjs`, 11 cases,
  wired into `npm test`): three text-tells from Business/MD&A/Risk — (1) pricing & costs (demonstrated
  pricing power vs. price-taking; input-cost pass-through), (2) critical-accounting-estimates topics
  (where the numbers rest on judgment), (3) integrity (material weakness / restatement). May surface a
  *strength*, unlike owner-flags. Guards: `HYPO` (conditional), `OFFSET_NEG` (negated pass-through).
- **Qualitative DISPLAYS** — all built, render-verified by synthetic injection (good/warn/bad tones,
  missing-prior + no-admission paths), full site builds clean: `OwnerNotice.astro` ("What an owner would
  notice" = the Buffett read), `CandorRead.astro` ("How management talks to owners" = bars + admissions),
  business-in-brief beneath the hero lede in `c/[ticker].astro`. Context act, except the brief.
  **Dark until the re-fetch populates `buffettRead`/`candor`/`brief`** (`mdnaChange` already shows via
  `OwnersRead.astro`'s "New language this year", so the "what changed" ask was already live).
- **Run-safety**: the per-company record assembly in `fetchFilings.mjs` is now `try/catch`-wrapped, so
  one odd filing logs and is skipped instead of aborting the ~65-min run.

## The plan (next bites, in priority)
### A. Qualitative re-fetch — FIRED, in progress
**The `filings_only=true` re-fetch is RUNNING (run `27733067944`, dispatched on the branch ~02:38 UTC
2026-06-18, ~65 min).** It populates the overview lede, Candor Read, business-in-brief AND the Buffett
read across ~2,538 companies, and the CI commits `language.json` to the branch (rebase-and-retry).
**When it lands, VERIFY real output (the documented method — detectors were only unit-tested on synthetic
text):**
- **EVERCORE (EVR)** lede — the founder's example: should now be the overview opening, not the
  cookie-cutter description.
- **Candor Read** across varied names; **calibrate `SCALE` (=8) and the bar feel in `CandorRead.astro`
  against the REAL density distribution** (compute owner/promo/adjusted quartiles over `language.json`).
- **Buffett read** on varied names: pricing power (look at a consumer staple / strong brand), price-taker
  (a commodity/retail name), integrity (rare — most trip nothing, which is correct). Spot-check that
  `criticalEstimates` finds the section on real MD&As (the section heading varies; widen `CRIT_HEAD`/the
  back-half window if hit-rate is low).
- **business-in-brief** beneath the hero on a few names (distinct from the lede, no boilerplate).
If a detector misfires on real text, refine the regex/guards and re-fetch.

**Still TODO in a LATER re-fetch batch (refinements, NOT explicit asks — build then fire once):**
- **Context framing**: competitive position / geographic + customer mix / moat language from Item 1
  (new detector, same shape as `candorSignals`, unit-tested).
- **Owner-flag tightening**: sharpen `ownerFlags`/`FLAG_THEMES` (capital-allocation / owner-orientation).
- **Pension & related-party tells**: live mostly in Item 8 notes / proxy, which the pipeline does NOT
  parse yet — would need extraction work first; deferred on purpose (don't ship a 3%-hit-rate detector).

### B. No-re-fetch work (independent — good for visible progress now)
- ~~**"What changed" display**~~ — ALREADY LIVE in `OwnersRead.astro` ("New language this year", reads
  `mdnaChange`/`riskChange.notable`). Nothing to build.
- **Scorecard normalization** (founder's explicit ask — the biggest remaining no-fetch item): make the Graham/Munger/Scorecard *checks*
  default to a **3–5yr average** (fewer if less history), not a single year — "average out the good and
  bad years." Touches the judgment logic in `fundamentals.mjs`, `graham.mjs`, `inversion.mjs`,
  `Scorecard.astro` (it already *displays* a 5-yr avg; make the *judgments* use it). PAGE-WIDE — build
  carefully, render-verify on cyclical names. No re-fetch.
- **Current Position panel** (founder's idea): Value Line-style fresh-quarter liquidity from
  `ttm.lines` — cash/receivables/inventory/other → current assets; AP/debt-due/other → current
  liabilities; working capital + current ratio. "More intelligent" because it's quarter-fresh.
- **Catalog redesign**: stop dumping all ~3,000 names at once by default (grouping/search/sectors).

### C. Merge to `main`: when a coherent verified batch is ready, ASK, then direct-merge the branch
(no PR; founder authorized direct merges for the expansion — re-confirm each time). A clean
`git merge` of the branch into `main` worked before; test-merge first.

## Technical gotchas
- Sandbox **blocks outbound fetch** (SEC/EDINET 403). All data fetches run in CI. npm registry IS reachable.
- **Can't test extraction on real 10-K text locally** — unit-test extraction logic on SYNTHETIC text
  (pattern: the `--input-type=module` node one-liners used this session), then re-fetch to verify real output.
- `heroTest.mjs` = offline regression for `businessDescription` (17 cases). `edinetTest.mjs` = JP parser
  regression. Run the relevant one after any extraction/EDINET change.
- Headless render: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` via `puppeteer-core`
  (`npm i puppeteer-core --no-save`). Symlink `/tmp/node_modules -> ./node_modules`, put the script in
  `/tmp`. To capture the full-width record table: move `.tenyear` to `document.body`, set
  `width:max-content`, clip to its box (Google Fonts blocked → serif falls back; layout accurate).
- `language.json` per company: `{ fy, priorFy, sourceUrl, business (lede string), brief (sentences[]),
  ownerFlags, mdna {words,fog,hedgeDensity,+Prior, candor {owner,promo,adjusted,admissions[]}, candorPrior},
  risk, mdnaChange {notableCount, notable[]}, riskChange, aiRead, comp }`.
- `fetchFilings.mjs` exports for testing: `businessDescription, candorSignals, businessBrief` (+ others).
  Key regexes: `BIZ_DOING/ISA/ENGAGED/RICH/SKIP/WEAK/STRUCTURAL`, `LEAD_VERB`, `HEAD_TOKEN`, `SIGNAL`, `HEDGE`.
- Data files: `fundamentals.json` (42MB), `language.json` (16MB), `segments.json`, `fundamentals.jp.json`,
  `universe.json` (3,108), `universe.jp.json` (33), `edinet-index.json` (EDINET crawl cache — its crawl
  *depth* persists across runs; reset by writing `{}` if it ever needs a clean crawl).
- **Git bloat watch-item**: `fundamentals.json` (42MB) re-commits each refresh; eventually move out of git
  (build-time fetch or release asset). Not urgent.
