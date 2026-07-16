// The Owner's Notebook — the reader's private record beside the published one.
//
//   GET  /api/notebook?ticker=X   → { notes, snapshots } for the signed-in reader, that ticker
//   POST /api/notebook { ticker, body } → create a note → { note }
//
// RLS scopes every row to the caller; these routes never use the service role, and
// scripts/notebookTest.mjs fails the build if one appears anywhere in the notebook code.
// The notebook is never the publication's data to read or aggregate — the queries here are
// the only reads that exist, and each carries the caller's own JWT.
export const prerender = false;

import { getUser, assertSameOrigin, json, apiHandler } from "../../../lib/gate/server.mjs";
import { validTicker, validNoteBody } from "../../../lib/notebook.mjs";

const LIST_LIMIT = 500;

export const GET = apiHandler(async (context) => {
  if (!assertSameOrigin(context)) return json({ error: "forbidden" }, 403);

  const { supabase, user } = await getUser(context);
  if (!user) return json({ error: "sign in to use the notebook" }, 401);

  const ticker = validTicker(context.url.searchParams.get("ticker"));
  if (!ticker) return json({ error: "bad ticker" }, 400);

  const [notesRes, snapsRes] = await Promise.all([
    supabase
      .from("notebook_notes")
      .select("id, ticker, body, created_at, updated_at")
      .eq("user_id", user.id)
      .eq("ticker", ticker)
      .order("updated_at", { ascending: false })
      .limit(LIST_LIMIT),
    supabase
      .from("notebook_snapshots")
      .select("id, ticker, taken_at, because, payload")
      .eq("user_id", user.id)
      .eq("ticker", ticker)
      .order("taken_at", { ascending: false })
      .limit(LIST_LIMIT),
  ]);
  if (notesRes.error || snapsRes.error) return json({ error: "try again" }, 500);

  return json({ notes: notesRes.data ?? [], snapshots: snapsRes.data ?? [] });
});

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
  const text = validNoteBody(body?.body);
  if (!text) return json({ error: "the note needs text (20,000 characters at most)" }, 400);

  const { data, error } = await supabase
    .from("notebook_notes")
    .insert({ user_id: user.id, ticker, body: text })
    .select("id, ticker, body, created_at, updated_at")
    .single();
  if (error) {
    // The database also caps notes (a trigger, so a direct PostgREST insert can't bypass it).
    if (/limit|cap/i.test(error.message || "")) return json({ error: "note limit reached" }, 400);
    return json({ error: "try again" }, 500);
  }
  return json({ ok: true, note: data });
});
