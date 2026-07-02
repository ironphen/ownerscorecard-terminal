// GET /api/auth/callback?token_hash=…&type=email&next=… — the magic-link landing. Verifies the
// link's token, writes the session cookies, and sends the reader on. A dead or consumed link
// lands on the sign-in page with a plain note rather than an error dump.
export const prerender = false;

import { supabaseServer, safeNext } from "../../../lib/gate/server.mjs";

export async function GET(context) {
  const url = context.url;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") ?? "email";
  const next = safeNext(url.searchParams.get("next"), context.url.origin);

  // Any failure (bad/expired token, or a config problem) lands on the sign-in page with a plain
  // note rather than an empty 500 — a magic-link click is a page navigation, so we redirect.
  try {
    if (tokenHash) {
      const supabase = supabaseServer(context);
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (!error) {
        return context.redirect(next, 303);
      }
    }
  } catch (e) {
    // fall through to the stale-link redirect
  }
  return context.redirect(`/auth/login?stale=1&next=${encodeURIComponent(next)}`, 303);
}
