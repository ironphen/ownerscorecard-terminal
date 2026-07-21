# Owner Scorecard — Phase 2 Plan (Commercialization, v2)

> Supersedes the architecture + sequence of `docs/commercialization-plan.md` (2026-06-30, on
> branch `claude/commercialization-plan`). Drafted 2026-07-01 after a 12-agent design +
> adversarial red-team pass. Locks the founder's decisions of 2026-07-01 and folds in the
> red-team's blocker fixes. A living document — amend deliberately, in writing (the EDITORIAL.md
> discipline).

The shape is unchanged from v1: **keep the free static site exactly as it is, and bolt on a secure
paid wing.** Not a re-platform — an addition. What v2 changes is the *product* (a subscription
research business, not a graded-calls scoreboard), the *money* (investing stays personal), and the
*content surface* (one tiered "Notes" publication) — and it repairs the concrete build hazards the
red-team found.

---

## 0. What changed from v1 — four decisions locked 2026-07-01

1. **Repo: ONE public repo** (not a second private app repo). Privacy comes from *where things live*
   (env secrets + Supabase Row-Level Security), never from hiding code (Kerckhoffs). No split is
   built; two lightweight code conventions (§1) would keep a future split mechanical, but it is
   revisited only if a concrete trigger appears (a co-developer who touches billing but not the brand
   asset; a genuinely separate app product; paid traffic large enough to isolate). All three
   independent judges converged on this.

2. **The paid product is a subscription marketable-security RESEARCH business — NOT a graded-calls
   record.** v1's "trust engine = a free graded calls record" is **dropped entirely.** It was two
   things at once, both fatal: it did not exist in the repo (100% net-new to build and maintain), and
   *a graded call is a verdict* — which "present, never pronounce" forbids and the codebase actively
   enforces (`scripts/lintNotes.mjs` bans figures/dates/trajectory; components render "a question,
   not an answer"). Trust instead rests on what OSC actually has: primary-source scorecards, the
   published method, and freshness. The paid **research** is where the analyst's reasoning lives.

3. **Float is the intent — invested to match the liability, not the ambition (§6).** Prepaid annual
   revenue *is* genuine float and the business should put it to work; the red-team's blocker was
   narrower than "don't invest it." Because that float is short-dated and refundable, the business
   invests it in **short-duration, liquid instruments** (T-bills / money-market) matched to the
   ≤12-month earn-out, minus a refund reserve — real yield, no forced-liquidation trap. The founder's
   **concentrated equity investing (his edge) stays personal**, funded by **drawn operating earnings**
   in his own brokerage — permanent capital that can ride a drawdown, which refundable float cannot.
   The trap is *float → volatile equities* on a small/lumpy early sub base, not float itself; the
   equity-float ambition scales in as the renewal base grows large and low-churn.

4. **Content = ONE "Notes" publication, tiered per item (~99% subscriber-only, a few free-to-all).**
   Replaces v1's separate "free essays vs paid dossiers." Each Note carries a `tier` flag. The free,
   durable `notes.json` blurb already on every scorecard (`whatItIs` + `needle`, 241 companies,
   lint-gated timeless) becomes the **teaser** for that company's full paid Note. Nav "Articles" →
   **"Notes."**

---

## 1. Repo / deploy topology

**One public repo, one Cloudflare Pages project, one origin (`ownerscorecard.com`).** Add
`@astrojs/cloudflare` but **leave `output` at its default** — only the handful of new gated routes
opt into on-demand SSR via `export const prerender = false`. Every one of the ~3,500 existing pages
keeps prerendering static exactly as today.

| Layer | What | Render | Visibility |
| :--- | :--- | :--- | :--- |
| Free (unchanged) | Scorecards, principles, free Notes, wire, lenses, directory/SEO | Static | Public |
| Paid (new) | Full per-company Notes + premium topic Notes | On-demand SSR, gated | Subscribers |
| Accounts (new) | Auth, follow, wire-email, billing | SSR + API | Per-user |

**We are not splitting the repo** (§0.1), so the elaborate four-part "split seam" from the design pass
is deliberately *not* built. Skip the two pieces that only pay off if a private app is ever spun up — a
`src/styles/tokens.css` extraction and a `/c/[ticker].json` data-contract endpoint. Keep only two
conventions, and only because they are good hygiene at any repo count — neither is an up-front task,
both are just *where code lives* when the backend is built:

1. **Corral all SSR** under `src/pages/api/*`, `src/pages/notes/*` (the gated reader), `/account`,
   `/auth/*`. Every `prerender = false` route lives here and nowhere else — so it's always obvious
   which routes are on-demand.
2. **One gate module:** all Supabase/Stripe SDK access behind `src/lib/gate/`. No `.astro` page
   reaches the SDK directly; no SSR route imports `src/data/*.json`.

Revisit a split only on a concrete trigger (a co-developer who should touch billing but not the brand
asset; a genuinely separate app product). Absent that, one repo — and these two conventions make a
split mechanical if the day ever comes.

**Honest caveat the red-team corrected:** adding the adapter + any SSR route **re-hosts the whole
site through a Cloudflare Worker.** The free pages are still cheap and still CDN-cached, but the claim
"byte-identical, provably $0, nothing changes" is *false*. Two CI tripwires keep it honest and must
land **in the same commit as the adapter, before any feature:**

- **HTML-count guard:** count `dist/**/*.html` — must stay ~3,500. Catches an accidental
  `output:'server'` or a stray `prerender=false` on a shared layout silently flipping the whole
  corpus to on-demand.
- **Bundle-import guard (must be a real bundle assertion, not a grep).** After build, inspect the
  Worker bundle and fail CI if it exceeds a size threshold **or** if any `src/data/*.json` resolves
  into it. The build-time JSON is ~52MB (`fundamentals.json` 24MB, `language.json` 20MB,
  `fundamentals.adr.json` 6MB, `segments.json` 2MB); a single transitive import of it into an SSR
  route blows Cloudflare's Worker size limit and breaks the deploy. SSR routes read **only** Supabase.

---

## 2. The content model — a single tiered "Notes" publication

**"Notes" is the research publication.** One index page lists all Notes; each Note has a `tier`
(`free` | `paid`), and ~99% are `paid`. This unifies the old "essays vs dossiers" split into one
surface with one mechanism.

- **The teaser is already built.** `src/data/notes.json` (241 companies, keys `whatItIs` / `needle` /
  `sourceFy` / `reviewed`) is public, in git, and lint-gated to be *durable and timeless* (no
  figures, dates, or trajectory). It stays free and becomes the **teaser** above each company's paid
  Note. It is **not** migrated into the paid store — it has the opposite temporal semantics and lives
  in git history forever. (Strike v1's "migrate notes.json → dossiers.")
- **A full Note is net-new writing:** dated, figure-bearing, thesis-driven research on the business.
  Paid Notes live **only in Supabase** (never in git, never in the static build). Free sample Notes
  are static/public (see §7).
- **The existing 11 MDX essays** fold in as free Notes (or a curated few stay free, the rest become
  the seed of the paid corpus — a launch-content decision, §10).

**Rename: "Articles" → "Notes."** Rename the nav label + `/articles` → `/notes` route dir, update the
~4 internal back-links **and `src/pages/rss.xml.js`** (it hard-codes `/articles/${id}/`), and add a
permanent `_redirects` 301 for `/articles/*` (preserves external / answer-engine citation equity).
The internal MDX collection id can stay `articles` to minimize churn.

*Naming-hygiene note:* "Notes" is now user-facing for the publication, while `notes.json` remains the
internal name for the per-company teaser blurb, and the paid research rows live in a Supabase table.
Keep these three distinct in code (suggested: teaser = `notes.json` unchanged; research rows =
Supabase `notes` table; free samples = MDX). Documented here so the overload never causes confusion.

---

## 3. The free / paid line

- **FREE (the funnel, the SEO engine, the trust proof — kept excellent):** every Owner Scorecard
  (US + ADR + JP) with its `notes.json` lede, the principles/concepts, the filings wire + "Fresh from
  the wire" feed, the archetype lens layer, and a small set of free sample Notes.
- **PAID:** the full per-company Notes + premium topic Notes.
- **Marketing samples:** flipping a Note to `tier:'free'` publishes it to everyone — the syndication
  lever. Free Notes are emitted as **static** pages, not routed through the SSR gate (§8), so your
  most shareable content can't go down with the backend.

---

## 4. Accounts

**Yes — free magic-link accounts, decoupled from purchase.** Do not make accounts appear only at
checkout.

- **Auth:** Supabase magic-link (matches the Dynasty Nexus stack), with the **6-digit OTP code as the
  primary/fallback affordance** — corporate link-scanners pre-fetch and consume single-use magic
  links, silently locking out members; a typed code is immune.
- **A free account gates nothing that is free today.** It powers exactly two things: **follow a
  company** (`follows(user_id, ticker)`) and **get the wire by email** (`wire_subscriptions`). A
  logged-out reader still sees every scorecard, free Note, principle, and the wire.
- **Why free-first:** the annual-prepay thesis lives or dies on a pre-built email list; the wire is
  the best capture asset OSC already has. A free account pre-provisions the `auth.users` row + Stripe
  customer, so checkout later is a one-click upsell. Ship accounts + wire-email **before** any
  paywall — it proves the auth stack in production under zero revenue pressure and builds the audience
  the "don't gate before an audience" guardrail requires.

---

## 5. Payments + paywall

**Stripe, annual-first, hosted UI — build zero billing screens.** Three SSR routes; everything else
static.

- **`POST /api/checkout`** — reads the session, get-or-creates the Stripe Customer, opens a Checkout
  Session (`mode='subscription'`, single annual Price, `allow_promotion_codes`,
  `client_reference_id=<user.id>`). One price, no monthly toggle.
- **`GET /api/portal`** — 302 to the Stripe Customer Portal for all renew/cancel/card/invoice actions.
- **`POST /api/stripe-webhook`** — the **only** writer to `subscriptions`, via the service role.
  Verify the signature on the **raw body** (`await request.text()`; any JSON parse first breaks
  verification). Idempotent upsert. Handles `checkout.session.completed`,
  `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`,
  `charge.refunded`, `charge.dispute.created`.

**The gate is two layers — RLS is the truth, the SSR route is the UX:**

- **Layer 1 (non-bypassable):** RLS on the `notes` table — `SELECT` the paid body allowed iff
  `(tier='free' AND status='published') OR (status='published' AND public.is_member(auth.uid()))`.
  Postgres refuses a paid body to a non-member even if app code is buggy.
- **Layer 2 (UX):** `/notes/[slug]` fetches the body through a per-request Supabase client bound to
  the **user's JWT cookie** (`@supabase/ssr`) — **never the service role.** A non-member's query
  returns no body; the route renders teaser + CTA. (Fetching with the service role and checking
  membership in JS is the single most likely way the paywall silently fails — do not.)

**One entitlement predicate — `public.is_member(uid)`** (SECURITY DEFINER) so RLS and the route can
never disagree: `status IN ('active','trialing') OR (status='past_due' AND now() < grace_until) OR
(cancel_at_period_end AND now() < current_period_end)`.

**Edge cases (all pure webhook → `is_member`, no manual ops):**

- **Dead card at renewal:** `invoice.payment_failed` → `past_due` + `grace_until = now()+14d`; keep
  access during grace (Stripe Smart Retries run ~2 weeks); a successful retry restores `active`.
- **Voluntary cancel:** `cancel_at_period_end=true` — they prepaid, keep access until
  `current_period_end`.
- **Refund / chargeback:** revoke immediately; flag disputed accounts against frictionless
  re-subscribe. (See §8 for the chargeback-economics guardrail.)
- **Lapsed member = downgrade, never lockout:** keeps login, follows, wire, and every free page;
  loses only paid bodies (which revert to the "renew to continue" teaser). Never delete data on lapse.

**Reconciliation (red-team fix):** the webhook is the sole writer, so a single missed webhook
silently locks out a payer or leaks access. Add a **nightly reconciliation cron** that lists Stripe
subscriptions changed in the last 48h and re-upserts rows — idempotent, same code path as the webhook.

---

## 6. Money structure — the float, done responsibly

Float **is** the intent, and it's real — the design rule is that it must be invested to match the
liability, not the ambition.

- **Prepaid annual revenue is genuine float:** the business's cash, cheaply funded by subscribers,
  and the business should put it to work. The difference from Buffett's insurance float is duration
  and stability, not kind — insurance float is long-tailed, huge, diversified, and cushioned by
  excess capital; a young annual-subscription float is small, lumpy, short-dated (all of it earns out
  or is refundable within 12 months), and disputable. Same idea, different risk profile.
- **So the business sweeps the deferred balance into short-duration, liquid instruments** — T-bills /
  money-market — matched to the ≤12-month earn-out, minus a refund/dispute reserve. At current rates
  that still throws off ~4–5% the business keeps: real, low-cost income. That is float, responsibly.
- **The trap to avoid** is funding concentrated equity positions (the founder's personal edge) with
  refundable subscriber cash — a drawdown coinciding with a churn/refund wave forces selling at the
  bottom to make subscribers whole. That specific *pairing* is what the red-team flagged, not "float."
- **The founder's alpha-seeking investing stays personal** — funded by **drawn operating earnings**,
  in his own brokerage. That is permanent capital that can't be clawed back, so it can ride volatile
  positions through a drawdown; the float cannot.
- **Why the equity edge stays personal — permanently, not "until scale" (the reason Berkshire doesn't
  port down):** keeping the entity's float in Government securities isn't only prudence, it's what
  keeps the business clear of two statutory lines a solo operator can't manage. **(1) Investment
  Company Act of 1940 — the 40% test:** a company is a regulated "investment company" (heavy SEC
  compliance) if *investment securities* exceed 40% of its total assets *excluding cash and Government
  securities*. T-bills are excluded, so short-Treasury float never counts toward it — but an equity
  book inside a light-asset publication trips it fast. Berkshire escapes only because controlled
  operating subsidiaries dominate its balance sheet (also excluded) at scale, with legal
  infrastructure to match. **(2) Personal Holding Company tax — the "60% rule":** a closely-held
  corporation whose income is ≥60% passive (dividends/interest/etc.) owes a penalty tax (~20%) on
  undistributed passive income. Both rules mean the same thing: **do not let investing dominate the
  entity, by assets or by income.** So the entity holds operating assets + Government-securities float
  only; the equity compounding runs in the founder's personal account, funded by drawn earnings —
  this does *not* unlock inside the business as it grows (a larger equity book trips the 40% test
  *sooner*). *(Not legal advice — confirm the entity/structure with a securities attorney + CPA.)*

---

## 7. Content / authoring pipeline

**Two editorial objects, two lints — never share tooling:**

- **Teaser blurbs (`notes.json`)** — free, in git, durable-by-doctrine, `lintNotes.mjs`-gated
  (no figures/dates/trajectory). Unchanged.
- **Notes (the research)** — paid, dated, figure-bearing, in Supabase only. Authored as **local
  gitignored markdown + YAML frontmatter** (`ticker`, `slug`, `title`, `tier`, `status`,
  `published_at`, `updated_at`, `teaser`, `summary`, body) + `scripts/pushNotes.mjs` that runs a
  **separate** lint (required frontmatter, unique slug, non-empty teaser — figures *allowed*) then
  upserts via the service role. Add `revision` + `supersedes_id` so a re-write links to its
  predecessor (evolution, never silent overwrite). Bodies never enter git. Supabase Studio is the
  fallback editor — no `/admin` to build at launch. Mirrors the existing `fetch:* → JSON →
  lint-in-npm-test` discipline the founder already trusts.

**Company-page teaser is build-time and body-free.** `pushNotes.mjs` writes a public, committed
`src/data/notes.index.json` containing ONLY `{ticker, slug, title, tier, teaser, dates}` — never the
body. `/c/[ticker].astro` imports it (exactly as it imports `notes.json` today) and renders a "Note"
card linking to `/notes/[slug]`. **CI asserts the index never contains a `body` field, caps `teaser`
length, and lints the teaser for verdict-words** (a teaser is marketing copy, not the Note's opening).

**Free sample Notes are emitted static.** When a Note is `tier:'free'`, `pushNotes.mjs` also writes
its body into a committed/prerendered path so it renders as a static page (its body is public anyway) —
keeping your best top-of-funnel content CDN-cached and immune to backend outages.

---

## 8. Red-team blocker fixes (the must-dos)

| # | Fix | Why |
| :--- | :--- | :--- |
| 1 | **Filter the sitemap.** `sitemap({ filter: (p) => !/\/(notes|account|auth|api)\//.test(p) })` in `astro.config.mjs`. | Today `sitemap()` has zero filter and would auto-publish paid `/notes/*` + `/account` URLs to Google. Paid Notes get discovered via the free teaser, not the sitemap. |
| 2 | **Two CI tripwires with the adapter** (HTML count ~3,500; no `src/data/*.json` in the Worker bundle). | The adapter re-hosts the site as a Worker; these catch a silent all-corpus SSR flip or a data-file import that breaks the deploy. |
| 3 | **Wire-email runs in the existing GitHub Actions `wire.yml`, not on Pages.** After `fetch:wire`, a `scripts/pushWire.mjs` reads `follows` + sends via the transactional provider. | Cloudflare **Pages has no cron.** `wire.json` is a build-time git artifact; the job that already has it + secrets is `wire.yml`. |
| 4 | **Path-scope the auth middleware.** `src/middleware.ts` early-returns (no Supabase call) unless the path starts with `/notes/`, `/account`, `/auth/`, `/api/`. | Astro middleware runs on *every* request; unscoped, `getUser()` would fire a network call on all 3,500 static page loads. |
| 5 | **Split email streams.** Transactional auth (magic link + OTP) from a dedicated subdomain/provider (e.g. Postmark) separate from the wire digest (broadcast). SPF+DKIM+DMARC before launch. | One spam-fold event on a shared new sending domain kills *both* login and the list. Deliverability is launch-blocking. |
| 6 | **Chargeback prevention on annual tickets.** Pre-renewal email 7–14 days out (also legally required for auto-renew in many places), clear billing descriptor, keep dispute rate low. | A single disputed high-value annual charge costs the amount + fee + counts against the dispute-rate threshold. |
| 7 | **Reconciliation cron** (see §5). | The webhook is the sole entitlement writer; missed webhooks must self-heal. |

---

## 9. Phased build sequence

**Phase 0 — Platform change, additive (no features):** add `@astrojs/cloudflare` (leave `output`
default); land both CI tripwires in the same commit; deploy adapter-only and confirm the free site is
unchanged and cheap. (Do this only when the first SSR route is imminent — a static rename like Notes
needs no adapter.)

**Phase 1 — Audience machine (zero revenue, no paywall):** Supabase Auth (magic-link + OTP);
`profiles`, `follows`, `wire_subscriptions` tables; path-scoped `src/middleware.ts`; split
transactional/broadcast email with SPF/DKIM/DMARC; Follow-button island on `/c/[ticker]`; wire-email
in `wire.yml`; **rename Articles → Notes** (+ 301, + rss.xml fix — DONE 2026-07-01, on
`claude/charts`); publish free Notes on a steady cadence. **The free product keeps improving
throughout** — the free instrument is the hook and the marketing; every hour spent making it more
thoughtful than any other free equity-research surface IS the customer acquisition.

**→ Willingness-to-pay kill-gate (locked 2026-07-01 — before a line of checkout code is written):**

- **Clock:** Phase 1 runs ~**6 months** from the wire-email going live.
- **Audience target:** on the order of **1,000+ engaged email subscribers** (the conventional ~2–5%
  paid-conversion base for a few-hundred-member launch).
- **The money gate:** **25–50 founding members prepay a real annual price via a plain Stripe payment
  link** — zero custom code, real dollars from strangers. Strangers' prepaid money is the only
  evidence that counts; everything else is vibes.
- **Honor the gate.** If the date arrives and the number isn't there, the honest reading is that the
  audience isn't forming at a living-wage rate — stop or pivot; do NOT build the billing machine
  anyway. This discipline is what bounds the downside to ~six months and makes the venture a serious
  business regardless of outcome. (Why the target is credible at all: at ~$400/yr, **~250 subscribers
  is a ~$100k/yr living** on a ~$0 cost base — the destination is hundreds of trusting readers, not
  millions of users.)

**Phase 2 — Paid wing (built, not switched on):** `is_member()` + RLS on `notes`; `subscriptions`
(+ `cancel_at_period_end`, `grace_until`); Stripe annual product; `/api/checkout|portal|stripe-webhook`
(raw-body verify, service-role upsert, idempotent) under the corralled dirs, behind `src/lib/gate/`;
`/notes/[slug]` gate (user-JWT client, teaser-or-body, `Cache-Control: private, no-store`);
`/account`; `pushNotes.mjs` + body-free `notes.index.json`; reconciliation cron.

**Phase 3 — Launch when there's an audience:** seed the paid corpus + free samples; verify the free
good stays prominent; flip the annual price live. Paywall-in-code is decoupled from pricing-switched-on.

---

## 10. Open decisions remaining (shape the launch, block nothing technical)

1. **Price posture** — the annual figure ($300–600/yr range per the opportunity map), whether a
   founding-member launch price runs, and the **grace-window length** (default 14 days). Recommend no
   free trial (dilutes the float benefit + adds `trialing` edge cases); convert via free sample Notes.
2. **Launch content** — how many company Notes are paid vs free at launch, which of the existing 11
   essays stay free, and which premium topic Notes seed the paid corpus.
3. **Wire-email default** — recommend a **weekly digest of followed tickers**, not daily-all.
4. **Paid-Note doctrine** — the free scorecards never pronounce; decide how far the paid research
   goes. Recommendation: reasoned, figure-bearing **research that takes a view where the analyst has
   one — but not a mechanical rating / price-target service** (that would re-import the Value Line
   rating OSC exists to replace). Settle this when the first Note is designed.

---

## 11. Guardrails (unchanged in spirit)

- **The free instrument never pronounces.** "Present, never pronounce" holds for every free scorecard;
  it is enforced in code and is the whole differentiation.
- **The free public good stays free and excellent** — it is the funnel, the SEO engine, and the reason
  anyone trusts the paid research.
- **Don't gate before there is an audience.** Phase 1 + the kill-gate come before the paywall.
- **Access-control and subscriber data are bulletproof; individual Notes are hard-to-take and
  pointless-to-take** — the moat is the compounding library + freshness + voice + trust, never the
  secrecy of one Note.
