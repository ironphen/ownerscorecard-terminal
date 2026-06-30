# Commercialization Plan — Owner Scorecard

> Architecture + build spec for adding a paid tier to Owner Scorecard without
> compromising the free public good. A living document — amend it deliberately,
> in writing (the EDITORIAL.md discipline). Drafted 2026-06-30.

This is the deliberate crossing of the "tripwire" the charter pre-registered:
*accounts or a native paywall as a committed feature triggers a re-evaluation of
the static-only architecture.* We are now committing, so this is that
re-evaluation.

The shape: **keep the free static site exactly as it is, and bolt on a secure
paid wing.** Not a re-platform — an addition. The free Scorecards stay the
funnel and the public good; the paid layer is the deep written research; the
annual subscription generates the **float** that is the whole financial point.

---

## 1. Decisions locked (2026-06-30)

1. **Backend stack: Supabase** (Postgres + Auth + Storage + Row-Level Security).
   Chosen to reuse the stack already proven on Dynasty Nexus (Supabase Auth +
   Postgres + RLS), not to learn a new one.
2. **Repo visibility: one public repo.** What's built stays public (brand + SEO
   + the charter's "open-sourcing the method is a brand move"). The new parts are
   made private **by where secrets and content live, not by hiding code** — see
   §2. (Optional escape hatch: a separate private app repo, §8 — not recommended
   unless there's a specific reason.)
3. **Free vs paid line:** the **current product stays free** (Scorecards,
   principles, essays, the graded record). The **next evolution — the deep
   per-company dossiers and premium topic pieces — is paid.** Individual dossiers
   can be flipped **free** as marketing samples via a per-row `tier` flag (§6).

---

## 2. The honest frame: "secure" ≠ "un-copyable"

Three things were called "stealable." They have three different, honest answers.

- **The code.** Security must never depend on hiding code (Kerckhoffs's
  principle: assume the attacker reads everything). The free-site code can stay
  public. The only things ever *secret* are credentials and the paid content —
  and neither lives in the code.
- **The paid dossiers.** We make them **access-controlled** — only an active
  subscriber can fetch them; never in the public repo; never in the static
  build; never in the page source for a non-subscriber. We **cannot** make them
  un-screenshottable — any subscriber can copy what they're shown; that is
  physics, not a bug to fix. Mitigate at the margin (watermark, rate-limit, ToS),
  but the real moat is the one the charter already names: the **compounding
  corpus + freshness + the graded record + trust + voice**, never the secrecy of
  one note.
- **Subscriber info + payments.** *Here* "cannot be stolen" is real and required.
  **Stripe holds the card data** (we never touch it → PCI scope offloaded); we
  store minimal PII in a secured DB; secrets in env; encrypted in transit and at
  rest.

**Target, stated plainly:** access-control and subscriber-data are bulletproof;
individual paid notes are *hard to take and pointless to take* (the value is the
living library, not any one dossier).

### How "private somehow" is actually achieved

Privacy comes from *where things live*, not from hiding code:

- **Secrets** (Supabase service key, Stripe secret key) → environment variables /
  Cloudflare secrets. **Never committed.** Private regardless of repo visibility.
- **Paid dossiers** → Supabase rows. **Never in git, never in the static build.**
  Private regardless of repo visibility.

With those two, the code can be 100% public and an attacker still gets nothing.
That is *more* secure than a private repo, because it never depends on the repo
staying secret.

---

## 3. Target architecture (additive)

| Layer | What | Render | Visibility |
| :--- | :--- | :--- | :--- |
| **Free** (unchanged) | Scorecards, principles, free essays, directory/SEO, graded record | Static (build-time, EDGAR JSON) | Public |
| **Paid** (new) | Deep per-company dossiers, premium topic pieces | On-demand SSR, gated | Subscribers only |
| **Accounts** (new) | Auth, subscriptions, billing | On-demand SSR + API | Per-user |

Astro 6 renders static by default; the Cloudflare adapter lets us opt *only* the
gated routes into on-demand rendering with `export const prerender = false`.
Everything else keeps building exactly as today.

**Stack**
- Front: Astro + `@astrojs/cloudflare`, static-by-default with SSR opt-in.
- Backend / DB / Auth: **Supabase** (Postgres + Auth + Storage + RLS).
- Auth glue: `@supabase/ssr` (cookie sessions in SSR).
- Payments: **Stripe** (Checkout + Customer Portal + webhooks), **annual-first**.
- Host: Cloudflare Pages (free site) + Functions/Workers (SSR + API).

---

## 4. Data model (Supabase Postgres)

```
auth.users            -- managed by Supabase Auth (email magic-link / OAuth)

profiles
  id                  uuid  (= auth.users.id)
  email               text
  created_at          timestamptz

subscriptions
  user_id             uuid  -> profiles.id
  stripe_customer_id  text
  stripe_sub_id       text
  status              text  -- active | trialing | past_due | canceled
  current_period_end  timestamptz

dossiers
  id                  uuid
  ticker              text
  slug                text  (unique)
  title               text
  body                text  -- markdown
  tier                text  -- 'free' | 'paid'   (the marketing-sample switch)
  status              text  -- 'draft' | 'published'
  published_at        timestamptz
  updated_at          timestamptz

calls                 -- the graded record (kept FREE; see §6)
  id                  uuid
  ticker              text
  thesis              text
  falsifier           text  -- pre-registered "what would change my mind"
  published_at        timestamptz
  grade               text  -- null until graded; no quiet deletions
  graded_at           timestamptz
```

### Row-Level Security (the gate, enforced at the DB layer)

- `dossiers` SELECT → allowed if `tier = 'free'` **OR** the requester has a row in
  `subscriptions` with `status = 'active'`. Even an app-code bug cannot leak a
  paid dossier — the database refuses it.
- `subscriptions` → a user may read their own row; **only the service role
  writes** (exclusively from the Stripe webhook).
- `profiles` → a user reads/updates their own row only.

---

## 5. Auth + Stripe + gating flow

1. **Sign in** → Supabase Auth (magic link); cookie session via `@supabase/ssr`.
2. **Subscribe** → server creates a Stripe Checkout session (the annual price) →
   Stripe-hosted checkout → success redirect.
3. **Webhook** (`checkout.session.completed`,
   `customer.subscription.updated|deleted`) → SSR endpoint upserts the
   `subscriptions` row with the service role → access unlocks.
4. **Manage** → `/account` links to the **Stripe Customer Portal** (Stripe-hosted)
   for renew / cancel / card update — we build no billing UI.
5. **Gate check** → the SSR route reads the session; RLS does the enforcement.

---

## 6. The free / paid line and marketing samples

- **Free (current product, untouched):** Scorecards, principles, essays.
- **Free on purpose — keep it free:** the **graded record** (`calls`). The charter
  wants it "as prominent as the research page"; it is the credibility engine *and*
  the best marketing. Gate the deep dossiers, never the proof.
- **Paid (the new evolution):** deep per-company dossiers, premium topic pieces.
- **Marketing samples:** the `dossiers.tier` flag *is* the mechanism. New dossiers
  default to `'paid'`; flip any single one to `'free'` and it renders publicly as a
  funnel piece (the content worth syndicating). One SSR route serves both:
  `/research/[slug]` loads the dossier → `tier = 'paid'` and no active sub →
  **paywall + teaser** (body never sent to the browser); `tier = 'free'` → render
  for anyone. Same code path; the flag decides.

---

## 7. Authoring (keep the markdown ergonomics)

Author dossiers as **local markdown files (gitignored)** + a small
`scripts/pushDossiers.mjs` that upserts them into Supabase. The file-based writing
flow is preserved; the content lands in the private DB and never enters git. A
real `/admin` editor can come later — start with the push-script + Supabase
Studio.

---

## 8. Repo / secrets / visibility

- **Free static site:** stays **public** (brand + SEO + open method).
- **Secrets:** env vars / Cloudflare secrets only — **never committed**, regardless
  of repo visibility.
- **Paid content:** Supabase rows — **never in git**.
- **Backend code:** public is genuinely safe (security never relies on it). *Escape
  hatch if code privacy is still wanted:* split the account/paid app into a
  separate private repo deployed at `app.ownerscorecard.com`. Works, but it is two
  projects to run — only do it for a specific reason; the env-vars + Supabase
  approach already delivers the real protection.

---

## 9. Sequence

**Phase 1 — now.** Keep producing free content and run the distribution test to
prove readers show up. The backend scaffolding *may* be built in parallel, but
**do not flip the paywall on until there is an audience to convert.** Build the
machine; pull the trigger on traction.

**Phase 2 — the paid wing (contained build).**
1. Add `@astrojs/cloudflare`; confirm every existing page still prerenders static.
2. Supabase: enable Auth; create the four tables; write the RLS policies.
3. Auth in Astro (`@supabase/ssr`): login / logout / session.
4. Stripe: annual product + price; Checkout API route; Customer Portal; webhook →
   sync `subscriptions`.
5. `/research/[slug]` SSR route: free-or-paywall logic.
6. Migrate `src/data/notes.json` → `dossiers` (mark each free/paid); pull them out
   of the static render; leave a teaser on `/c/[ticker]`.
7. `scripts/pushDossiers.mjs` authoring script.
8. Wire the company-page teaser → "Read the full dossier (members) →".

**Phase 3 — launch.** Pricing live, annual-first, the free marketing dossiers
published, the float turned on.

---

## 10. Open product decisions (block nothing technical, but shape the launch)

- **Price** — the annual figure (priced for seriousness, not the $9 floor;
  annual-first to maximize float and crush churn).
- **The exact free/paid contents list** — which dossier depth/cadence is paid;
  whether premium topic pieces are paid or just timely; how many free marketing
  samples to seed at launch.

---

## 11. Guardrails (do not let monetization erode the mission)

- **No verdicts, even behind the paywall.** "Present, never pronounce" holds for
  paid dossiers too. Paying for a price target would betray the only
  differentiation — and the safe publisher's lane.
- **Keep the graded record free and prominent.** It is the trust engine.
- **Don't gate before there is an audience.** Building billing before readers is
  the builder's trap; Phase 1 comes first.
- **The free public good stays free and excellent.** It is the funnel, the SEO
  engine, and the reason anyone trusts the paid layer.
