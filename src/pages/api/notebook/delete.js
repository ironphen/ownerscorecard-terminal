// POST /api/notebook/delete { id, kind } — remove one of the reader's own notes or snapshots.
// Snapshots are append-only (never edited) but they remain deletable: delete means delete,
// and the reader's privacy outranks the ledger ethos on the reader's own data.
export const prerender = false;

import { getUser, assertSameOrigin, json, apiHandler } from "../../../lib/gate/server.mjs";
import { validId, NOTE_KINDS } from "../../../lib/notebook.mjs";

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

  const id = validId(body?.id);
  if (!id) return json({ error: "bad id" }, 400);
  const kind = String(body?.kind ?? "");
  if (!NOTE_KINDS.has(kind)) return json({ error: "bad kind" }, 400);

  const table = kind === "note" ? "notebook_notes" : "notebook_snapshots";
  const { data, error } = await supabase
    .from(table)
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");
  if (error) return json({ error: "try again" }, 500);
  if (!data || data.length === 0) return json({ error: "not found" }, 404);
  return json({ ok: true });
});
