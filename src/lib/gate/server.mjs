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
          // Security flags come AFTER the spread so a caller-supplied option can never downgrade
          // them (no non-httpOnly, non-Secure, or SameSite=None session cookie can slip through).
          context.cookies.set(name, value, {
            path: "/",
            ...options,
            httpOnly: true,
            secure: true,
            sameSite: "lax",
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

// Wrap a JSON API handler so a thrown error becomes a clean JSON response, never an empty 500 the
// browser can't even parse. A missing-configuration error is surfaced distinctly (so the operator
// sees "not configured" instead of a generic failure); everything else is logged to the worker's
// observability and returned as a safe generic message (never leak internals to the client).
export function apiHandler(fn) {
  return async (context) => {
    try {
      return await fn(context);
    } catch (err) {
      const msg = String((err && err.message) || err || "");
      if (/not configured/i.test(msg)) {
        return json({ error: "sign-in is temporarily unavailable" }, 503);
      }
      console.error("[api]", (context.url && context.url.pathname) || "", msg);
      return json({ error: "something went wrong — please try again" }, 500);
    }
  };
}

// Only ever redirect to a path on THIS site. A prefix check ("/…" and not "//…") is not enough:
// browsers normalize a backslash to a slash under WHATWG URL rules, so "/\evil.com" becomes
// "//evil.com" (protocol-relative → offsite). So validate by resolving against our own origin and
// confirming the result stays on it — the same normalization the browser will apply — and reject
// control/whitespace characters outright.
export function safeNext(raw, origin, fallback = "/account") {
  if (typeof raw !== "string" || !raw) return fallback;
  // Reject backslashes (browsers fold them to "/") and ASCII control chars; ordinary path
  // characters — letters, digits, hyphens, dots — must pass so "/notes/the-melting-arr" survives.
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x5c) return fallback;  // control chars + backslash (0x5c)
  }
  try {
    const u = new URL(raw, origin);
    if (u.origin !== origin) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
