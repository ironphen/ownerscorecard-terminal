// POST /api/follow { ticker } — toggle whether the signed-in reader follows a company. Returns
// { following } so the button can render the new state. 401 for a visitor (the client sends
// them to sign in). RLS scopes every row to the caller; this route never uses the service role.
//
// Ticker validation is format-only (the same check the database enforces) rather than a lookup
// against the catalog: the fundamentals JSON is ~24MB and must never enter the worker bundle
// (scripts/verifyStatic.mjs). A follow on a ticker we don't cover simply never matches a wire
// item — harmless by construction.
export const prerender = false;

import { getUser, assertSameOrigin, json } from "../../lib/gate/server.mjs";

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const MAX_FOLLOWS = 200;

export async function POST(context) {
  if (!assertSameOrigin(context)) return json({ error: "forbidden" }, 403);

  const { supabase, user } = await getUser(context);
  if (!user) return json({ error: "sign in to follow companies" }, 401);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }

  const ticker = String(body?.ticker ?? "").trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) return json({ error: "bad ticker" }, 400);

  // Toggle: delete if present, insert if absent.
  const { data: existing, error: readErr } = await supabase
    .from("follows")
    .select("ticker")
    .eq("user_id", user.id)
    .eq("ticker", ticker)
    .maybeSingle();
  if (readErr) return json({ error: "try again" }, 500);

  if (existing) {
    const { error } = await supabase
      .from("follows")
      .delete()
      .eq("user_id", user.id)
      .eq("ticker", ticker);
    if (error) return json({ error: "try again" }, 500);
    return json({ ok: true, following: false });
  }

  const { count } = await supabase
    .from("follows")
    .select("ticker", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((count ?? 0) >= MAX_FOLLOWS) {
    return json({ error: `follow limit reached (${MAX_FOLLOWS})` }, 400);
  }

  const { error } = await supabase
    .from("follows")
    .insert({ user_id: user.id, ticker });
  if (error) return json({ error: "try again" }, 500);
  return json({ ok: true, following: true });
}
