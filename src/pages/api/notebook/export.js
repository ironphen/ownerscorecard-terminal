// GET /api/notebook/export?format=md|json — the reader's whole notebook, one self-describing
// file, session-authed. The export is the ownership proof and is never paywalled (design doc
// §3.5): markdown is the human copy, JSON the lossless one. Reads via the caller's own JWT —
// never the service role — and the response is private, no-store like every notebook response.
export const prerender = false;

import { getUser, assertSameOrigin, json, apiHandler } from "../../../lib/gate/server.mjs";
import { exportMarkdown, exportJson } from "../../../lib/notebookExport.mjs";

const PAGE = 1000;

async function all(supabase, table, cols, order) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(cols)
      .order("ticker", { ascending: true })
      .order(order, { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error("read failed");
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

export const GET = apiHandler(async (context) => {
  if (!assertSameOrigin(context)) return json({ error: "forbidden" }, 403);

  const { supabase, user } = await getUser(context);
  if (!user) return json({ error: "sign in to export your notebook" }, 401);

  const format = context.url.searchParams.get("format") === "json" ? "json" : "md";
  let notes, snapshots;
  try {
    [notes, snapshots] = await Promise.all([
      all(supabase, "notebook_notes", "ticker, body, created_at, updated_at", "updated_at"),
      all(supabase, "notebook_snapshots", "ticker, taken_at, because, payload", "taken_at"),
    ]);
  } catch {
    return json({ error: "try again" }, 500);
  }

  const exported = new Date().toISOString().slice(0, 10);
  const body = format === "json"
    ? exportJson({ exported, notes, snapshots })
    : exportMarkdown({ exported, notes, snapshots });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="owner-notebook-${exported}.${format === "json" ? "json" : "md"}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
