// @ts-check
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

// Sitemap lastmod comes from HONEST stamps only, never the build clock (a new Date() would mark
// 3,550 unchanged pages fresh on every deploy and teach crawlers to ignore the signal): data-backed
// pages carry the fundamentals pipeline's own asOf; each note carries its frontmatter updated/date.
// Paths are anchored to THIS FILE, not the working directory (build runners differ), and the whole
// gathering is best-effort: a missing stamp means a sitemap entry without lastmod, never a dead build.
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
let dataStamp = null;
const noteStamps = {};
try {
  const m = readFileSync(here('./src/data/fundamentals.json'), 'utf8').match(/"asOf"\s*:\s*"(\d{4}-\d{2}-\d{2})/);
  dataStamp = m ? m[1] : null;
} catch { /* no stamp, no lastmod */ }
try {
  for (const f of readdirSync(here('./src/content/articles'))) {
    if (!f.endsWith('.mdx')) continue;
    const src = readFileSync(here(`./src/content/articles/${f}`), 'utf8');
    const pick = (k) => (src.match(new RegExp(`^${k}:\\s*(\\d{4}-\\d{2}-\\d{2})`, 'm')) || [])[1];
    const stamp = pick('updated') || pick('date');
    if (stamp) noteStamps[f.replace(/\.mdx$/, '')] = stamp;
  }
} catch { /* no stamps, no lastmod */ }

// The dateline stamps (lib/freshness.mjs), read here and injected as build-time constants via
// vite.define below. The dateline renders on the server-rendered account page too, and when
// freshness.mjs imported the data pools to read their stamps, whichever chunk Rollup colocated
// them into could ride the account page's import of BaseLayout straight into the Cloudflare
// worker — the exact ~45MB leak scripts/verifyStatic.mjs exists to catch, and a chunking
// accident that actually fired when the archetypes demolition reshaped the import graph. Each
// pool file carries its own top-level `asOf` within the first bytes, so 2KB of each is plenty;
// best-effort like the sitemap stamps above (a missing stamp reads as absent, never a dead build).
const asOfStamps = [
  './src/data/fundamentals.json',
  './src/data/fundamentals.adr.json',
  './src/data/language.json',
  './src/data/rates.json',
].map((p) => {
  try {
    const m = readFileSync(here(p), 'utf8').slice(0, 2048).match(/"asOf"\s*:\s*"(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  } catch { return null; }
}).filter(Boolean).sort();

// https://astro.build/config
export default defineConfig({
  site: 'https://ownerscorecard.com',
  // The first Note shipped under the-de-rating slug; the essay was retitled in place
  // (2026-07-05) and the old URL is already in mailers, crawlers, and readers' history.
  // Never break it. TEMPORARY (2026-07-07): all published pieces (both research notes AND
  // the founding letter) are unpublished while the author's final hand-written drafts are
  // prepared; their URLs redirect to the notes index rather than 404 so saved links and the
  // /about page's letter link keep resolving. On each republish, remove that piece's
  // temporary redirect (and re-point the-de-rating at the moat note).
  // The retired /archetypes routes 301 to /groupings, /tests and /flags from public/_redirects
  // (the /articles precedent), NOT from here: a config redirect becomes a worker route that
  // imports its destination page module, and those destinations import the data pools — ~45MB
  // into the Cloudflare worker, past scripts/verifyStatic.mjs's ceiling.
  redirects: {
    '/notes/the-de-rating': '/notes',
    '/notes/the-moat-and-the-multiple': '/notes',
    '/notes/the-two-investors-2026': '/notes',
    '/notes/the-founding-letter': '/notes',
  },
  // Hover-gated only: the catalog view holds 3,503 company links, so 'viewport' or 'load'
  // strategies would fire thousands of requests per session against the Workers free tier.
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  // The adapter enables on-demand rendering for the (future) gated routes ONLY. `output` stays at
  // its default: every page prerenders static exactly as before, and a route becomes dynamic solely
  // by declaring `export const prerender = false`. The post-build guard (scripts/verifyStatic.mjs)
  // fails the deploy if the static corpus ever silently shrinks or the worker bundle swallows the
  // big data JSONs — see docs/phase-2-plan.md §1.
  adapter: cloudflare(),
  vite: {
    define: {
      // The oldest stamp (the honest dateline floor) and the newest — the same convention
      // lib/freshness.mjs documents.
      __OSC_DATA_AS_OF__: JSON.stringify(asOfStamps[0] ?? null),
      __OSC_DATA_AS_OF_LATEST__: JSON.stringify(asOfStamps[asOfStamps.length - 1] ?? null),
    },
  },
  integrations: [mdx(), react(), sitemap({
    // Account/auth/API surfaces are per-user, never for the index. The free /notes pages stay in —
    // they are the publication; paid Notes render on demand and so never enter the build-time
    // sitemap in the first place.
    filter: (page) => !/\/(account|auth|api)\//.test(page),
    serialize(item) {
      const note = item.url.match(/\/notes\/([^/]+)\/?$/);
      const lastmod = note ? noteStamps[note[1]] : dataStamp;
      return lastmod ? { ...item, lastmod } : item;
    },
  })],
});
