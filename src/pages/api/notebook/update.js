// POST /api/notebook/update { id, body } — rewrite one of the reader's own notes. Notes are
// the editable half of the notebook; snapshots have no update route (and no update RLS
// policy) by design — a dated appraisal is never rewritten.
export const prerender = false;

import { getUser, assertSameOrigin, json, apiHandler } from "../../../lib/gate/server.mjs";
import { validId, validNoteBody } from "../../../lib/notebook.mjs";

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
  const text = validNoteBody(body?.body);
  if (!text) return json({ error: "the note needs text (20,000 characters at most)" }, 400);

  const { data, error } = await supabase
    .from("notebook_notes")
    .update({ body: text, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, ticker, body, created_at, updated_at")
    .maybeSingle();
  if (error) return json({ error: "try again" }, 500);
  if (!data) return json({ error: "not found" }, 404);
  return json({ ok: true, note: data });
});
