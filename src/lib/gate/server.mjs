// The gate — the single module through which server code reaches Supabase.
// docs/phase-2-plan.md §1: no .astro page or API route imports the SDK directly, and nothing in
// here may import src/data/*.json (the worker bundle must stay lean; scripts/verifyStatic.mjs
// enforces the ceiling). Sessions ride in httpOnly cookies via @supabase/ssr; every entitlement
// decision starts from supabase.auth.getUser() (validates the JWT against the auth server),
// never getSession() (which trusts the cookie unverified).
import { createServerClient, parseCookieHeader } from "@supabase/ssr";

// Runtime configuration. On Cloudflare the secrets live on the Worker (locals.runtime.env);
// in local dev they come from .dev.vars / import.meta.env. Never hardcoded, never committed.
function envOf(context, name) {
  return (
    context.locals?.runtime?.env?.[name] ??
    import.meta.env[name] ??
    undefined
  );
}

export function supabaseServer(context) {
  const url = envOf(context, "SUPABASE_URL");
  const key = envOf(context, "SUPABASE_ANON_KEY");
  if (!url || !key) {
    throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_ANON_KEY).");
  }
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return parseCookieHeader(context.request.headers.get("cookie") ?? "");
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          context.cookies.set(name, value, {
            path: "/",
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            ...options,
          });
        }
      },
    },
  });
}

// The identity read every gated route starts from. Returns { supabase, user } — user is null
// for a visitor, and routes decide their own response (401 for APIs, redirect for pages).
export async function getUser(context) {
  const supabase = supabaseServer(context);
  const { data, error } = await supabase.auth.getUser();
  return { supabase, user: error ? null : (data?.user ?? null) };
}

// CSRF floor for state-changing endpoints: same-origin only. The session cookie is SameSite=Lax,
// which already blocks cross-site POSTs in modern browsers; this check is the second layer
// (defense in depth, and it also refuses non-browser cross-origin calls with a stolen cookie
// header). Sec-Fetch-Site is checked when present; Origin is required to match otherwise.
export function assertSameOrigin(context) {
  const sfs = context.request.headers.get("sec-fetch-site");
  if (sfs) return sfs === "same-origin" || sfs === "none";
  const origin = context.request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === context.url.host;
  } catch {
    return false;
  }
}

// Uniform JSON response with the cache posture every per-user response must carry: an
// authenticated body must never be cached at the edge or served to another visitor.
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

// Only ever redirect to a path on this site — a `next` parameter from a query string must not
// become an open redirect to elsewhere.
export function safeNext(raw, fallback = "/account") {
  if (typeof raw !== "string") return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}
