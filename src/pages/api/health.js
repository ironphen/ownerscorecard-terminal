// GET /api/health — a real end-to-end check: does the worker have its runtime configuration,
// and does the database actually answer? The DB probe matters twice over: Supabase pauses free
// projects after ~a week of inactivity (which would silently break sign-in, follows, and wire
// prefs), and the daily uptime workflow hitting this endpoint doubles as the keep-alive that
// prevents the pause. Reports booleans only — never key values, never infrastructure hosts.
// @astrojs/cloudflare v13 removed Astro.locals.runtime; env comes from the workers module.
export const prerender = false;

import { env } from "cloudflare:workers";

export async function GET() {
  let url = null, anonKey = null, seen = false;
  try {
    seen = !!env;
    url = (env && env.SUPABASE_URL) || null;
    anonKey = (env && env.SUPABASE_ANON_KEY) || null;
  } catch (e) {}
  // Normalize the same way the gate does, so the check reflects the tolerant behavior.
  if (url) {
    url = String(url).trim().replace(/^["']+/, "").replace(/["']+$/, "").trim();
    if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
  }

  // Touch the database through PostgREST with the anon key. RLS keeps the result empty for an
  // anonymous caller; what we're measuring is that postgres answered at all.
  let db = false;
  if (url && anonKey) {
    try {
      const r = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, {
        method: "HEAD",
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        signal: AbortSignal.timeout(5000),
      });
      db = r.ok;
    } catch (e) {}
  }

  const body = {
    ok: seen && !!url && !!anonKey && db,
    runtimeEnvSeen: seen,
    supabaseConfigured: !!(url && anonKey),
    db,
  };
  return new Response(JSON.stringify(body), {
    status: body.ok ? 200 : 503,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
