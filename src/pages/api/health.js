// GET /api/health — a dependency-free diagnostic: does the worker actually receive its runtime
// configuration? Reports presence booleans and the (non-secret) Supabase host only — never the key
// values. Safe to leave in place; leaks nothing a normal Supabase client wouldn't already expose.
export const prerender = false;

export async function GET(context) {
  const env = (context.locals && context.locals.runtime && context.locals.runtime.env) || {};
  const url = env.SUPABASE_URL || null;
  let host = null;
  try { host = url ? new URL(url).host : null; } catch (e) {}
  const body = {
    ok: true,
    runtimeEnvSeen: !!(context.locals && context.locals.runtime && context.locals.runtime.env),
    supabaseUrlPresent: !!url,
    supabaseUrlHost: host,
    anonKeyPresent: !!env.SUPABASE_ANON_KEY,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
