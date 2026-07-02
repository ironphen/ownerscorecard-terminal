// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  site: 'https://ownerscorecard.com',
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
  })],
});
