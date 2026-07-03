// @ts-check
import { readFileSync, readdirSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

// Sitemap lastmod comes from HONEST stamps only, never the build clock (a new Date() would mark
// 3,550 unchanged pages fresh on every deploy and teach crawlers to ignore the signal): data-backed
// pages carry the fundamentals pipeline's own asOf; each note carries its frontmatter updated/date.
const fundamentalsAsOf = (() => {
  try {
    const m = readFileSync('./src/data/fundamentals.json', 'utf8').match(/"asOf"\s*:\s*"(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  } catch { return null; }
})();
const dataStamp = fundamentalsAsOf;
const noteStamps = {};
for (const f of readdirSync('./src/content/articles')) {
  if (!f.endsWith('.mdx')) continue;
  const src = readFileSync(`./src/content/articles/${f}`, 'utf8');
  const pick = (k) => (src.match(new RegExp(`^${k}:\\s*(\\d{4}-\\d{2}-\\d{2})`, 'm')) || [])[1];
  const stamp = pick('updated') || pick('date');
  if (stamp) noteStamps[f.replace(/\.mdx$/, '')] = stamp;
}

// https://astro.build/config
export default defineConfig({
  site: 'https://ownerscorecard.com',
  // Hover-gated only: the catalog view holds 3,503 company links, so 'viewport' or 'load'
  // strategies would fire thousands of requests per session against the Workers free tier.
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  // The adapter enables on-demand rendering for the (future) gated routes ONLY. `output` stays at
  // its default: every page prerenders static exactly as before, and a route becomes dynamic solely
  // by declaring `export const prerender = false`. The post-build guard (scripts/verifyStatic.mjs)
  // fails the deploy if the static corpus ever silently shrinks or the worker bundle swallows the
  // big data JSONs — see docs/phase-2-plan.md §1.
  adapter: cloudflare(),
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
