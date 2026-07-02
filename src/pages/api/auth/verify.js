// POST /api/auth/verify { email, token } — complete a sign-in with the emailed six-digit code.
// On success @supabase/ssr writes the session cookies (httpOnly, Secure, SameSite=Lax).
export const prerender = false;

import { supabaseServer, assertSameOrigin, json, apiHandler } from "../../../lib/gate/server.mjs";

export const POST = apiHandler(async (context) => {
  if (!assertSameOrigin(context)) return json({ error: "forbidden" }, 403);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }

  const email = String(body?.email ?? "").trim().toLowerCase();
  const token = String(body?.token ?? "").trim();
  if (!email || !/^\d{6}$/.test(token)) {
    return json({ error: "enter the six-digit code from the email" }, 400);
  }

  const supabase = supabaseServer(context);
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) {
    return json({ error: "that code didn't work — it may have expired; request a new one" }, 401);
  }
  return json({ ok: true });
});
