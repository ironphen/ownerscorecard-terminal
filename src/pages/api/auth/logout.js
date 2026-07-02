// POST /api/auth/logout — end the session and clear the cookies.
export const prerender = false;

import { supabaseServer, assertSameOrigin, json } from "../../../lib/gate/server.mjs";

export async function POST(context) {
  if (!assertSameOrigin(context)) return json({ error: "forbidden" }, 403);
  const supabase = supabaseServer(context);
  await supabase.auth.signOut();
  return json({ ok: true });
}
