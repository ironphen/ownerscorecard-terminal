// GET /api/health — a diagnostic: does the worker actually receive its runtime configuration?
// Reports presence booleans and the (non-secret) Supabase host only — never the key values.
// @astrojs/cloudflare v13 removed Astro.locals.runtime; env comes from the workers module.
export const prerender = false;

import { env } from "cloudflare:workers";

export async function GET() {
  let url = null, anonPresent = false, seen = false;
  try {
    seen = !!env;
    url = (env && env.SUPABASE_URL) || null;
    anonPresent = !!(env && env.SUPABASE_ANON_KEY);
  } catch (e) {}
  let host = null;
  try { host = url ? new URL(url).host : null; } catch (e) {}
  const body = {
    ok: true,
    runtimeEnvSeen: seen,
    supabaseUrlPresent: !!url,
    supabaseUrlHost: host,
    anonKeyPresent: anonPresent,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
