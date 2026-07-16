// POST /api/notebook/snapshot { ticker, payload, because? } — freeze a dated appraisal: the
// reader's dial state, the rendered readout, the record basis, and the day's bond yield, as
// S2's capture serializes them. Append-only from the moment it lands: there is no update
// route and no update RLS policy, so a dated appraisal can be deleted but never rewritten.
export const prerender = false;

import { getUser, assertSameOrigin, json, apiHandler } from "../../../lib/gate/server.mjs";
import { validTicker, validPayload, validBecause } from "../../../lib/notebook.mjs";

export const POST = apiHandler(async (context) => {
  if (!assertSameOrigin(context)) return json({ error: "forbidden" }, 403);

  const { supabase, user } = await getUser(context);
  if (!user) return json({ error: "sign in to use the notebook" }, 401);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }

  const ticker = validTicker(body?.ticker);
  if (!ticker) return json({ error: "bad ticker" }, 400);
  const payload = validPayload(body?.payload);
  if (!payload) return json({ error: "bad snapshot" }, 400);
  const because = validBecause(body?.because);
  if (!because.ok) return json({ error: "the because line runs long (500 characters at most)" }, 400);

  const { data, error } = await supabase
    .from("notebook_snapshots")
    .insert({ user_id: user.id, ticker, payload, because: because.value })
    .select("id, ticker, taken_at, because, payload")
    .single();
  if (error) {
    if (/limit|cap/i.test(error.message || "")) return json({ error: "snapshot limit reached" }, 400);
    return json({ error: "try again" }, 500);
  }
  return json({ ok: true, snapshot: data });
});
