// POST /api/auth/send { email, next? } — start a sign-in: Supabase emails a six-digit code and a
// magic link (the code survives corporate link-scanners that consume single-use links; both work).
export const prerender = false;

import { supabaseServer, assertSameOrigin, json, safeNext, apiHandler } from "../../../lib/gate/server.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST = apiHandler(async (context) => {
  if (!assertSameOrigin(context)) return json({ error: "forbidden" }, 403);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }

  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ error: "enter a valid email address" }, 400);
  }

  const next = safeNext(body?.next, context.url.origin);
  const callback = new URL("/api/auth/callback", context.url.origin);
  callback.searchParams.set("next", next);

  const supabase = supabaseServer(context);
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callback.toString() },
  });

  // Rate limits and transient failures surface as a plain retry message — never the raw
  // provider error, which can leak configuration detail.
  if (error) {
    const tooMany = /rate|too many/i.test(error.message ?? "");
    return json(
      { error: tooMany ? "too many attempts — wait a minute and try again" : "could not send the email — try again" },
      tooMany ? 429 : 500
    );
  }
  return json({ ok: true });
});
