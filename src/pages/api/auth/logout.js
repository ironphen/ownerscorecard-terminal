// POST /api/auth/logout — end the session and clear the cookies.
export const prerender = false;

import { supabaseServer, assertSameOrigin, json, apiHandler } from "../../../lib/gate/server.mjs";

export const POST = apiHandler(async (context) => {
  if (!assertSameOrigin(context)) return json({ error: "forbidden" }, 403);
  const supabase = supabaseServer(context);
  await supabase.auth.signOut();
  return json({ ok: true });
});
