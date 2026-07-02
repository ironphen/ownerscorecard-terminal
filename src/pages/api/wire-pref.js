// POST /api/wire-pref { enabled, frequency? } — the wire-by-email preference. One row per user;
// the mailer (service role, run from the wire GitHub Action) reads enabled rows.
export const prerender = false;

import { getUser, assertSameOrigin, json } from "../../lib/gate/server.mjs";

export async function POST(context) {
  if (!assertSameOrigin(context)) return json({ error: "forbidden" }, 403);

  const { supabase, user } = await getUser(context);
  if (!user) return json({ error: "sign in first" }, 401);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }

  const enabled = body?.enabled === true;
  const frequency = body?.frequency === "daily" ? "daily" : "weekly";

  const { error } = await supabase
    .from("wire_subscriptions")
    .upsert(
      { user_id: user.id, enabled, frequency, scope: "follows", updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) return json({ error: "try again" }, 500);
  return json({ ok: true, enabled, frequency });
}
