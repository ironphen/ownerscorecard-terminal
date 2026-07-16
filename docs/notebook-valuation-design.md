=== DESIGN DOC BEGINS ===

# Owner's Notebook + Valuation Tool — Build Design Doc

**Date:** 2026-07-16 · **For:** founder green-light · **Sources:** four partner reviews (Graham, Buffett, layout, architect), synthesized after independent verification against the live files. Every line reference below was re-checked against `src/components/Valuation.astro` (1,166 lines) as it stands on `main`; all load-bearing claims held.

**Read this first:** the two builds are one build. The Notebook offers to engrave the tool's output into a reader's permanent, immutable appraisal history. That makes the tool's correctness fixes a *precondition*: we must not freeze today's mixed-numerator readouts (§1, item 1) into anyone's record. Sequence: fix the figures, then offer the pen.

---

## 1. Valuation-tool improvements, ranked

Items both partners converge on lead. Every item names its license and passes/states its doctrine check ("present never pronounce"; arrangement is a pronouncement; the reader's belief must be the reader's).

### 1.1 MUST — One owner-earnings definition per surface; comparisons on the base in use *(Buffett must; Graham's lane-map confirms)*

**The defect (verified):** the interactive base is CFO − total capex (line 88) — the lib's own `freeCashFlowAbs` — labeled "owner earnings" throughout. But delivered growth (`gDeliv5`, lines 223-235), the base-rate windows (`oeWins`, 241-249), and the durability-card figure all run on `ownerEarningsAbs` = CFO − *maintenance* capex ("the single definition the whole site reads", fundamentals.mjs). Worse, `data-gdeliv` (line 420) is `gDeliv5 ?? gDeliv` — a maintenance-based figure falling back to an FCF-based one, so even the fallback chain mixes. And `oeHistMaint` (line 130) uses raw depreciation while `ownerEarningsMaint` (129) uses `maintenanceCapex(co)` — a third quiet variant. The foot confesses the seam: line 541 prints "Free cash flow" when the maintenance toggle is offered. The headline comparison — implied vs delivered vs "K of N windows" — is apples against oranges, and it biases the base-rate count in the builder's favor (a maintenance-based delivered series systematically beats an FCF-based implied requirement).

**License:** 1986 letter appendix — owner earnings is one named figure with its capex estimate admitted; the appendix was written against quiet numerator switches. Graham's Security Analysis ch.37 earning power is likewise one averaged figure, not a rotating cast.

**Fix:** delivered growth, sparkline, ladder marker, cushion comparison, and base-rate windows all compute on the *same capex treatment as the base in use*. Precompute both window/CAGR families server-side (total-capex and maintenance), swap client-side with the Steady-state toggle. One maintenance definition for history and latest (uniform per-year rule; where history can't support it, withhold — never mix). SBC netting, when toggled, applies to base and series alike or the comparison is withheld. Foot names the definition in use; the "Free cash flow" seam disappears.

**Doctrine check:** pure correctness; no new defaults, no new numbers. **Founder decision D1** (§5.5): keep CFO − total capex as the resting default (recommended — the conservative *filed* figure, Graham's instinct) vs flipping the default to the maintenance-based 1986 definition with strict FCF as the toggle (Buffett-literal). Either way the mixing dies.

### 1.2 MUST — Symmetric normalization default: pre-check Normalize on a peak *(Graham must; Buffett's "flattering default" standard agrees)*

**The defect (verified):** `defaultNorm`/`defaultMaint` (lines 151-152) switch the through-cycle base on only when the latest year is *negative* — rescuing the tool. When the latest year is a *peak* (`cycleRead === "above"`), the reader gets only the cyclenote footnote (450-455) while the flattering single-year base stays the default. The correction fires only in the direction that raises the base.

**License:** Intelligent Investor ch.14 (p.349) prices on the 3-year average precisely to avoid paying on a peak; SA ch.37 earning power is "not less than five years." The trough default already establishes that the tool may open on the honest base; symmetry closes the asymmetry.

**Fix:** when `cycleRead === "above"`, ship `oeNorm` pre-checked; the basenote explains it in the same register the trough case already uses; clearing the toggle reads the year as filed. The bond yardstick inherits automatically (it reads `effOE()`).

**Doctrine check:** this *removes* an arrangement-level pronouncement in the price's favor. The default is a symmetric rule, not a suggested assumption.

### 1.3 MUST — The mature-margin machinery: gate the row, touch-gate the requirement *(Graham must + Buffett strong — full agreement)*

**The defect (verified):** `mmDial` ships resting at 25% (line 487) and `reqRev` renders the derived revenue requirement the moment a price is typed, before the reader touches the dial (983-989). The negative mode already has the correct pattern twenty lines away: `mmTouched` (1063-1066).

**License:** Graham 1958 ("precise formulas with highly imprecise assumptions can be used to justify practically any value one wishes"); the repo's own ratified rule ("the reader's belief must be the reader's", valuation-doctrine-review.md REMOVE list). Buffett adds the existence question: for a mature business the dial is a second belief machine answering a question the price never asked.

**Fix (both halves):** (a) render `marginRow` only when the implied terminal margin exceeds today's margin (Buffett's gate — the case where the price actually demands a margin belief); (b) `reqRev` renders only after the dial is touched (Graham's gate, copying `mmTouched`).

### 1.4 STRONG — Required-return dial: rename, decompose, rest on the dated bond *(Buffett strong; Graham's placement finding leans on the same generalization)*

**The defect (verified):** the bond *field* opens on the dated Treasury (294-297, 1005-1006) while the rate *dial* opens on a house-chosen 9% (line 534) — one control defaults to a dated public fact, the other to the publication's number. The 9% is the last suggested assumption on the page.

**License:** 2000 letter — the Aesop yardstick rate is "the yield on long-term U.S. bonds"; risk is handled in the certainty of flows and the price paid, never by fiddling the rate. The ladder already says "return required"; unify the vocabulary.

**Fix:** rename "Discount rate" → "Required return". Default the dial to the dated long-bond yield from rates.json. *Refinement at implementation (founder-directed, 2026-07-16):* ONE risk-free yardstick for every market — the 10-year US Treasury on US, JP, and EU pages alike. The JGB anchor was built first and dropped: a per-market anchor makes the same implied growth read differently across borders (arrangement is a pronouncement), and the resting JGB (2.5% snapped) collided with the 2.5% terminal-growth rest, which would have greeted every JP price with an error. The terminal rest now sits at least a point below the required-return rest by construction.

**D2 AMENDED (founder decision, 2026-07-16, same day, after seeing the bond rest live):** the dial's rest returns to **9%** on every surface. A bond-alone rest made every price read soft (implied growth against a 4.5% hurdle understates what a price asks), and 4.5% is no equity buyer's required return. What the reform KEEPS: the "Required return" name everywhere; the live decomposition line, which now carries the honesty the bond-rest was after — the resting 9% is always restated as the dated Treasury plus an explicit premium ("9.0% = the 4.58% 10-year Treasury (Jul 14, 2026) + 4.42 points of equity premium. The rate you require is yours to set.") so the house resting place is arithmetic in the open, never laundered; the dated-Treasury reference on /compare; and the terminal-rest-below-required-rest safeguard. What retires: the zero-premium resting state and its lede clause. Decompose live beside the dial: "8.9% = 4.62% 10-yr Treasury (Jul 13) + 4.3% you demand." **Honesty clause for the resting state:** at rest the premium is zero, which is itself a statement — so until the dial is touched, the lede's discount clause reads "…discounted at the 4.62% bond yield alone; the premium you demand for equity risk is yours to add." Zero-premium is named, never laundered. The protection against any single rate monopolizing the answer is already structural: the schedule prints all four discount columns (R_COLS, 736) and the ladder prints every return rung (943-957) regardless of the dial. **Founder decision D2** (§5.5).

### 1.5 STRONG — Kill the delivered-rate presets in the REIT and negative modes *(Graham strong; main mode's own pattern is the license)*

**The defect (verified):** `reitGrowthPct` (194) presets the REIT growth dial to the delivered FFO CAGR; `gRevPct` (207) presets the negative mode's revenue dial to delivered revenue growth — so "justified by growth" renders on load on a past-continues extrapolation the site chose. The already-logged 8%=8% divide-by-zero (page-review-findings.md:159) is a symptom.

**License:** SA ch.37's warning against projecting the trend; the main mode already solved it — the delivered rate is one labeled row of a general schedule, "the other rows are anyone's beliefs" (761).

**Fix:** rest these dials at fixed neutral values (REIT 3%, neg-mode 0% or touch-gated justified readout); the delivered rate stays exactly where it already is — the labeled `DeliveredGrowth` anchor beside the dial — never the resting assumption. Bank dials (10% / 3%) are fixed neutral rests, not delivered presets; they stay, and enter the §4 default audit.

### 1.6 STRONG — Bank mode: 3-year EPS and the ch.14 gate *(Graham strong)*

**The defect (verified):** `epsB` = latest-year net income / shares (169), feeding P/E and earnings yield (1106), while the mode's own foot names the credit cycle as the risk; the 15×/22.5 Graham gate never renders in bank mode. A bank at a credit-cycle peak is the canonical flattering single-year P/E.

**License:** Intelligent Investor ch.14, "Financial Enterprises" — the same price/earnings/book standards apply. The mode already medians ROTCE over the record (170-173); the P/E row is the unfinished half.

**Fix:** 3-year-average (or record-median) EPS for the bank P/E and earnings-yield rows, labeled with its actual span; extend the 15×/22.5 gate to bank/insurer mode.

### 1.7 STRONG — Name material stock comp even when the toggle is off *(Buffett strong; Graham symmetric-honesty agrees)*

CFO adds SBC back, so both bases silently include it today; the unchecked box is the flattering default. When SBC > ~5% of the base in use, the Base-in-use line (825-831) adds one clause: "includes $X of stock comp CFO adds back; the toggle above expenses it." License: 1998 letter ("If options aren't a form of compensation, what are they?…"). Defaulting the toggle *on* for the heaviest issuers is **founder decision D4** — deferred; the naming ships now.

### 1.8 STRONG — Removals (fewer numbers) *(Buffett strong; Graham's register agrees)*

Drop "Multiple paid" from the compare row (exact reciprocal of "Owner-earnings yield" two cells away; the multiple survives in sensLoc prose and the ops line). Drop "×revenue" from opsMc (965) for positive-owner-earnings filers — a promoter's denominator; revenue stays where it is load-bearing (implied-margin arithmetic, negative mode). License: 1993 ("approximately right"), 2000 (deriding metric-shopping). Each redundant readout dilutes the one comparison that carries the tool.

### 1.9 CONSIDER — small honesty and one addition each

- **Label the actual span:** `eps3` accepts a 2-year mean (line 101) under a "P/E (3-yr earnings)" label — label what the arithmetic did. *(Graham)*
- **Negative-mode tier adjectives** (1055-1056: "all but a handful," "most profitable software businesses") — replace with the counted, attributed form the main mode uses (base-rate register, "no adjective attached"). *(Graham)*
- **Accumulated spread line** (Graham's one ch.20 addition): beside the yield spread, "at this spread, ten years accumulates to X% of your price" — his own arithmetic (his ch.20 example runs to ~50% of price), dated, adjective-free.
- **Reinvestment line** (Buffett, 1992): delivered incremental return on retained owner earnings → "growing X%/yr would require retaining ~Y%; over the record N retained Z%." Symmetric, filed-record arithmetic. **Buffett's own rule: if added, it displaces a removal, never stacks.** Possibly merged with the distribution sentence (dividends+buybacks as % of OE — Aesop's "when do the birds come out") into one retention/distribution line.
- **Look-through caveat** (Buffett, 1990/91): where equity-method income is material, one sentence that CFO-based owner earnings exclude undistributed investee earnings. Rare pages, large unnamed gap.
- **Defensive tests, factual link** (Graham): "Graham's defensive tests: this record meets k of 7" next to the price gate, reusing grahamTests counts. Never a badge, never a grade — Graham classifies investors, not securities. Reader-declared posture (defensive/enterprising in the account, reordering emphasis for that reader only) is a later, doctrine-clean idea.

**Do not touch (Buffett must, agreed):** the reverse framing itself, the decline lede, the 100%+ cap, the price-gating of every derived dollar, the schedule/ladder as general arithmetic, the bond yardstick with the dated public yield. The spine is right; the doctrine review already removed what he'd have removed first.

---

## 2. The dials decision

**The founder's tentative suggestion:** move the year + discount-rate dials to the very top, above everything.

**What is actually there (layout, verified):** price first (434), outputs and schedule in the middle, dials *last* (532) — below even the bond yardstick, in all four modes. Nobody ever ratified dials-last; the documented arrangement decisions are about price-gating and the schedule, not dial position. The founder's move is last-to-first, and the current placement is inherited, not defended.

**The honest case FOR moving them:** Graham's discipline is assumptions before answer. The classic anchoring objection is weak *here* because this is a reverse-DCF — growth, the contaminable assumption, is an **output**; the dials are the reader's required return and horizon, which legitimately precede looking at any company. Record-first is already enforced by the page's four-act arc (dials live in Act IV, below business/record/quality). And the Notebook makes it sharper: a snapshot is more honestly "my assumptions" when the assumptions were met before the output.

**The honest case AGAINST the literal version (all three lanes):** the page's identity is *price in → implied assumptions out*. Opening on three assumption sliders reads as a forward DCF — assumptions in, value out — the exact direction the doctrine review killed when it removed the reference value. It would promote the resting values (9%, 10yr, 2.5%) into the page's first statement (arrangement-as-pronouncement in the wrong direction), and it buries the one required act — the price — below the fold on mobile. Graham and Buffett both note the existing protections are stronger than placement: the lede wears the assumptions inline (903), the schedule prints all four discount columns regardless of the dial (736), the ladder prints every rung (943-957). Buffett's sequence in every published valuation discussion: business first, price second, rate last.

**REJECTED outright (unanimous where addressed):** dials above everything. Also rejected: the inert-until-scrolled assumptions bar (paternalist, breaks `?px=` deep links and the `#act-price` nav, "visible but dead" controls read as broken; no house precedent for an input that polices reading progress).

**RECOMMENDATION — the synthesis (layout's, with Buffett's dial reform attached):**

- Price row stays first. **The three dials move directly beneath the price row** (after the base toggles / baseUsed / evTog block, before the lede) as one declaration cluster: *your price, your base, your required return, your horizon* — then everything below is visibly the reader's arithmetic. Terminal growth moves with the trio.
- The bondBox stays where it is; the dialsNote's dated bond figure and bondView's lede carry the bond-plus-premium teaching across the separation.
- Applies to **all four modes** identically (divergent arrangement between modes would itself pronounce).
- Copy geography sweep with the move: sensNote "the dials below" (761), cyclenote "Normalize, below" (453), negative-mode "the margin dial below" (1057-1058), foot phrasing (549-550). A moved dial block with stale "below" copy is the seam a hostile reader screenshots.
- This also satisfies the architect's lane constraint: dials and the implied readout end up within one viewport, so the Notebook's capture control sits where the reader can see everything they are signing.

Why this beats status-quo-plus-anchor-links (the Graham/Buffett concession): the placement was never ratified; the grammar objection is fully answered by keeping the price first; and the Notebook needs dials + readout co-visible, which anchor links do not deliver. If the founder prefers the conservative option, the fallback is: leave placement, make the lede's inline assumption mentions anchor-links that scroll to and flash the dials. **Founder decision D3.**

---

## 3. The Notebook

### 3.0 The soul

Graham put his method's number on the public record — the Dow's central value, **396 against an actual ~410**, Senate Stock Market Study hearings p.546, March 1955 (already in `docs/graham-1955-factbase.md`) — and let the market resolve it. The Notebook is that discipline made private: **the reader's own dated appraisal record**, on their own prices, against the filed record, never graded by anyone but themselves. It is also the Owner's Manual made product: the publication refuses to publish its own estimate and gives the facts; the snapshot is the reader forming their own, dated, with a written reason. Both partners endorsed it in exactly this frame; the doctrine review had already reserved its slot ("option 6" — the reader's private ledger, opt-in, arriving on schedule).

### 3.1 Schema — two tables, opposite temporal semantics

New migration `supabase/migrations/20260716_notebook.sql`, house style of `20260702_accounts.sql`:

```sql
-- notebook_notes: living documents. Editable, deletable.
create table notebook_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  ticker     text not null check (ticker ~ '^[A-Z][A-Z0-9.\-]{0,9}$'),
  body       text not null check (char_length(body) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- notebook_snapshots: dated claims. Append-only, deletable whole, never revisable.
create table notebook_snapshots (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  ticker      text not null check (ticker ~ '^[A-Z][A-Z0-9.\-]{0,9}$'),
  mode        text not null check (mode in ('oe','neg','bank','reit')),
  kind        text not null default 'priced' check (kind in ('priced','appraisal')),
  inputs      jsonb not null,   -- dial/toggle state + typed price + local calendar date
  readout     jsonb not null,   -- what the tool showed, verbatim + parsed
  record      jsonb,            -- filed basis: base kind/value, FY, shares+basis, netdebt, ccy, bond default
  caption     text check (char_length(caption) <= 500),
  captured_at timestamptz not null default now()
);
```

Indexes `(user_id, ticker, captured_at desc)` and `(user_id, ticker, updated_at desc)`. RLS: notes get select/insert/update/delete scoped `auth.uid() = user_id` (update with both `using` and `with check` so `user_id` can't be rewritten); **snapshots get select/insert/delete only — no UPDATE policy exists**, so even a reader POSTing directly to PostgREST with their own JWT cannot revise one. Caps enforced by trigger (the `enforce_follow_cap` precedent): 1,000 notes / 2,000 snapshots per user; jsonb payloads ≤ 8KB with a `pg_column_size` backstop; API-side per-mode key allowlist (finite numbers or strings ≤ 200 chars).

Why two tables: a working note is a living document; an appraisal is a dated claim. One table with an "immutable" flag invites policy bugs; two make the distinction structural. **You can tear a page out of your own notebook; you cannot rewrite what it said.** Notes show "written Jun 3 · edited Jul 1."

The `kind` column ships now so the wave-2 pre-price appraisal (§3.8) needs no migration.

### 3.2 Snapshot capture — exactly what is captured (all three lanes agree)

A snapshot is a **frozen copy of the computed figures, never a pointer re-derived against refreshed data**. Re-running old dials against a refreshed record and a moved bond yield would silently rewrite the reader's past appraisal — the one dishonesty the feature exists to prevent, and the architect's hard reject. Captured, per mode:

- **inputs:** typed price; shares if reader-entered; every dial value; every toggle state (norm/sbc/maint/evOn); bond yield in the field; `mmTouched`-class flags; the client's local calendar date (`localISO()` from priceMemory.mjs — an evening capture in the Americas must not post-date itself).
- **readout:** the rendered sentences verbatim — **the lede sentence plus the Base-in-use line are the snapshot's human core** (layout's finding: what you save is exactly what you read, and a snapshot taken on untouched defaults still *states* its assumptions plainly rather than laundering them) — plus parsed numerics: implied growth, OE yield, base-rate count as it stood ("K of N windows"), spread over bond, justified multiple / P/TBV / P/FFO per mode, cushion figure.
- **record:** the filed basis — base kind and dollar (which toggles), fiscal year the record ran through (an appraisal without its record's as-of is unanchored), share count + basis + as-of (`sharesForValue`), net debt, currency, the dated bond default, delivered growth as shown that day.
- **caption:** one optional free-text line, set at capture, immutable with the snapshot, never prompted with suggested questions (product DNA). Buffett's discipline: a snapshot of dial positions without the "because" preserves the arithmetic and loses the judgment; Graham's ch.20: figures, *persuasive reasoning*, actual experience.

**Review rule (Buffett, hard):** any future surface that shows an old snapshot beside the present does so against what the business subsequently **filed** (did owner earnings deliver the believed rate?), never against the subsequent **quote** — grading against price would seat Mr. Market at the desk. And never auto-graded either way: the dated pair is presented, the comparison is the appraiser's act (Graham compared 396 to 410 himself). No computed "right/wrong," no adjectives, even privately.

### 3.3 Privacy architecture — stated at its true strength

"The publication never reads your notes" cannot be cryptographically absolute (the service-role key exists; the dashboard reaches any row; platform backups retain rows for the retention window). Overclaiming would be the one lie that poisons a trust-first publication. The credible version is five layers:

1. **RLS** scoped `auth.uid() = user_id`; every route reads via the user-JWT client from `src/lib/gate/server.mjs`. **The service role never touches notebook tables in any code path — a stated invariant.**
2. **Zero aggregation code.** No analytics table, no cross-user query, no counts, ever (including anonymized "most-noted companies" — rejected outright).
3. **CI tripwire:** `scripts/notebookTest.mjs` in `npm test` fails if anything under `src/pages/api/notebook*` or any SSR route references the service role or selects notebook tables outside the user-JWT client (the verifyStatic test-gate discipline).
4. **No content logging:** routes log pathname + error only (the gate's apiHandler already does this — keep it); responses carry `Cache-Control: private, no-store`. One debug line shipping note bodies to worker logs would falsify the commitment.
5. **The public repo as the audit:** the phase-2 Kerckhoffs decision becomes the proof — anyone can verify no aggregation path exists. No closed competitor can match this.

Plus a **published, dated privacy commitment** (on /account and beside the notebook strip), in house voice, naming the caveat honestly: what is stored; who can technically reach it ("the database administrator role can reach any row — true of every hosted service"); what we commit in writing never to do (query, read, aggregate, train, sell); the standing proof (public repo, RLS in the open migration, the export). Dated and amended in writing, like EDITORIAL.md — the publication putting *its* promise on the record the way readers put their appraisals on theirs.

Client-side E2E encryption (key on device) is a documented **future option, memo before build** — the only path to an absolute promise, but key-loss = notebook-loss shipped to a small early base is a worse trust risk than the caveat it removes. Rejected for build-1.

**Offline/degraded (never lose a typed word):** the editor persists drafts to localStorage on every input (`osc-nb-draft-{ticker}`, the priceMemory pattern), cleared only on confirmed save; failed POST → "kept on this device — retry," draft intact; failed snapshot → localStorage outbox with retry; failed GET → "notebook unavailable right now" + local draft; the valuation tool never depends on the notebook. No JS: the page is whole, the notebook simply absent.

### 3.4 Free vs paid

**Free-account feature, forever; export never paywalled.** The third thing a free account powers, beside follows and the wire. It is the strongest funnel asset the phase-2 plan could ask for — daily-habit depth, genuine personal switching cost, and the pre-provisioned auth row that makes checkout one click — and holding a reader's own writing hostage would invert the ownership premise and poison the trust the paid Notes depend on. No paid capacity tier either (rejected). Paid = the Notes research, full stop.

### 3.5 Export — ships in build-1

`GET /api/notebook/export?format=md|json` (default md), session-authed, one self-describing file (`owner-notebook-YYYY-MM-DD.md`): every note and snapshot — dates, tickers, full dial state, full readout, record basis — with a format header. Markdown is the human proof (readable in any editor decades hence — the text file of dated appraisals Graham would have kept); JSON is lossless. Per-entry delete and a "download my notebook" line on /account. The export IS the ownership proof; shipping it later would mean launching with lock-in.

### 3.6 UI placement

Company pages stay **static** (the HTML-count tripwire enforces ~3,500 prerendered pages): the notebook is a client island fetching `/api/notebook?ticker=X` after load, the account-page join pattern.

- **Capture control:** a quiet, price-gated text line in the `.gatenote` register, **directly under the lede/compare block inside each mode box** — not beside the dials (dials alone are not an appraisal; the price + assumptions + reading triple is, and it is complete only at the lede), not a standing button (a standing solicitation). Appears only when a priced reading exists — it can never solicit an empty save. Wording as the reader's act: "Enter this in your notebook — dated, yours." One optional single-line "because" field beneath it. Under the §2 synthesis, price → dials → lede → capture sit in one viewport: the reader signs what they see.
- **Prior snapshots** for the ticker listed beneath as dated one-liners: "Jun 3, 2026 — $211.40 · 9% / 10yr / 2.5% · implied +14%/yr · 22.4× owner earnings."
- **NotebookStrip** (free-text notes) directly below the valuation section, marked as the reader's ink ("yours, private — we never read it"), signed-out state = one quiet sign-in line.
- **Nudge hard lines (§4).** Dates display in the reader's timezone from `captured_at`; the stored local calendar date rules the export.

### 3.7 Killed (partner rejects, consolidated)

E2E encryption in build-1 · any paywall/capacity tier on the notebook · snapshot share links in build-1 (sharing invites the notebook to become performance; the ledger of *public* judgment is the publication's own job) · **any** aggregation including anonymized counts · recomputing snapshot readouts from current data · auto-grading in any form · grading against subsequent quotes · dials-above-everything · the inert-until-scrolled bar · a stock-level "defensive-grade" badge.

### 3.8 Wave-2 (after build-1 proves live)

- **Pre-price appraisal snapshot** (`kind='appraisal'`, Graham strong): base, toggles, dials, and the justified-multiple schedule with no price typed, plus an optional reader-typed dollar figure and one line of reasoning the publication never computes or parses — write the appraisal down *before* watching the price, the central-value discipline itself. Doctrine-airtight (the reader's dollar, if any, is typed by the reader; doctrine review §4 blesses the multiplication as the reader's act). Deferred only because it complicates the capture UI's "never solicit an empty save" rule; schema is ready.
- Signed-out local-only notebook with import-on-signin (the follow-echo pattern; doubles the state machine, earns its place after the synced core).
- Snapshot-beside-subsequent-filings compare view (under the §3.2 review rule).
- E2E encryption memo; wire day-permalink deep-links in snapshot lines; export polish.

---

## 4. Doctrine guards — implementation rules

1. **Audit every default.** Every input's resting value is classified and enforced: *reader-act* (price, shares, reader-typed figure — required, never prefilled), *public-fact* (dated bond yield — prefilled, dated, editable), *belief* (growth dials, mature margins, premiums — must rest neutral or be touch-gated before any derived figure renders from them). Current violations and their fixes: mmDial 25% (§1.3), REIT delivered preset (§1.5), neg-mode revenue preset (§1.5), discount-rate 9% (§1.4 — becomes public-fact + explicit reader premium). Passing today: neg-mode margin (mmTouched), bank coe/growth (fixed neutral; keep in the audit table). **Rule: no derived figure may ever render from an untouched belief-class default.**
2. **The tool never suggests assumptions.** No prefill may encode "the past continues"; the delivered rate is always a labeled anchor beside a dial, never its resting value. No prompted questions in any free-text field, ever.
3. **The notebook never aggregates.** No code path may read notebook rows across users; the service role never touches notebook tables; the CI tripwire enforces both on every push; no analytics, no counts, no "popular" anything, anonymized or not.
4. **Snapshots are frozen.** Stored readouts, never recomputed; no UPDATE policy in Postgres; review surfaces show dated pairs against subsequent *filings* only; no auto-grading, no adjectives.
5. **Capture must not nudge.** No persistent/floating save button, no unsaved-state indicators, no confirmation celebration, no counters or streaks, no exit prompts, no pre-checked anything. The control appears with the priced output and otherwise does not exist. Register mitigates the residual "sessions should end in a save" implication: italic gatenote, the reader enters, the page never asks.
6. **Never log content.** Route logs = pathname + error only; `private, no-store` on all notebook responses.
7. **All four modes move together.** Any arrangement change applies to oe/neg/bank/reit identically, with a copy-geography sweep for stale "below/above" strings (453, 761, 1057-1058, foot).
8. **The published commitment is amended the same day behavior changes** — including the existing "Nothing is stored" bond-box copy (796), which must gain "…unless you enter it in your notebook" the day capture ships.

---

## 5. Build plan

### 5.1 Sequencing

**Track A (valuation fixes) ships before Track B's capture goes live.** The must-fix numerator mixing (§1.1) means today's delivered/base-rate readouts are partly wrong; the Notebook would engrave them into immutable reader history. Fix the figures, then offer the pen.

### 5.2 Track A — valuation tool (~3 sessions, no schema)

- **A1:** §1.1 series unification (both window families precomputed, client swap; one maintenance definition; foot naming) + §1.2 symmetric Normalize + label fixes (eps3 span; foot seam). Touches Valuation.astro, fundamentals wiring, universeTest/page tests.
- **A2:** §1.3 marginRow gates + §1.4 required-return reform (rename, decompose, Treasury rest on every market per the founder's one-yardstick directive, zero-premium lede clause) + §1.5 REIT/neg preset kills + §1.6 bank 3-yr EPS + ch.14 gate + §1.7 SBC naming + §1.8 removals + neg-mode adjective fix.
- **A3:** §2 dials move, all four modes + copy sweep + mobile/one-viewport verification + (optional, D6) one consider-tier addition.

### 5.3 Track B — notebook (4 sessions, architect's plan adopted)

- **S1:** migration `20260716_notebook.sql` (tables, RLS, cap triggers) + API routes — `GET /api/notebook?ticker=` → `{notes, snapshots}`; `POST /api/notebook` (create note); `POST /api/notebook/update`; `POST /api/notebook/delete` `{id, kind}`; `POST /api/notebook/snapshot`; all `prerender=false`, assertSameOrigin, getUser, follow.js validation style — + `scripts/notebookTest.mjs` in `npm test` (validation round-trips + the no-service-role tripwire). The tripwire and schema define the privacy story everything else advertises.
- **S2:** capture inside Valuation.astro — `src/lib/notebookCapture.mjs` (per-mode collector serializing dial state + rendered readout text + record basis), gatenote control + because-field + prior-snapshot list. Exercises the API end-to-end with the smallest UI.
- **S3:** `NotebookStrip.astro` — editor, list, edit/delete, localStorage draft + outbox.
- **S4:** account-page "Your notebook" section (tickers, counts, latest, links) + export endpoint + the published privacy commitment copy.

**Estimate: ~7 sessions total** (3 + 4), consistent with the follows+wire-pref precedent. Note: `docs/phase-2-plan.md` lives only on branch `claude/phase-2-plan`; the migration merges to main. Gate lesson applies: new routes need their tests inside `npm test` before the commit gate.

### 5.4 Later (post build-1)

Pre-price appraisal snapshots · signed-out local notebook · filings-compare view · E2E memo · consider-tier valuation lines not chosen in D6 · reader-declared posture.

### 5.5 Founder decisions needed before code

- **D1 — Default owner-earnings base:** keep CFO − total capex as the resting default with maintenance as the toggle (recommended: the conservative filed figure) vs flip to the maintenance-based 1986 definition. Either way §1.1's mixing fix proceeds.
- **D2 — Required-return rest:** dated bond yield with the zero-premium state named in the lede (recommended) vs keep a house resting value. Affects A2.
- **D3 — Dials placement:** adopt the synthesis (price first, dials directly beneath, all modes — recommended) vs status quo + anchor-linked lede. Affects A3 and the capture line's viewport.
- **D4 — SBC toggle default-on for heavy issuers:** deferred recommendation; the naming clause ships regardless.
- **D5 — Commitment copy authorship:** the published privacy commitment is publication voice on the record; per the authorship doctrine the founder may want to hand-write its final draft. Needed before S4.
- **D6 — Consider-tier picks:** recommend the accumulated-spread line only (it displaces "Multiple paid" per Buffett's displace-don't-stack rule); reinvestment/distribution/look-through wait.
- **Name check:** "Owner's Notebook" as the surface name (plain businesslike noun; matches the product's register).

=== DESIGN DOC ENDS ===