// The taxonomy migration's redirect layer (2026-07-17). Cloudflare's _redirects file caps
// at 100 dynamic rules — the deploy hard-fails past it, which is how the 256-line migration
// file killed two builds (the log: "Maximum number of dynamic rules supported is 100.
// Skipping remaining 168 lines."). So the old grouping and chapter URLs move here instead:
// an old path has no static asset anymore, which routes its request to this worker, where a
// map lookup issues the 301. _redirects stays lean (the pre-taxonomy 25 lines) for the
// rules that predate this; every taxonomy-era URL move belongs in redirectMap.json.
import REDIRECTS from "./data/redirectMap.json" with { type: "json" };

export function onRequest(context, next) {
  const path = context.url.pathname.replace(/\/+$/, "") || "/";
  const to = REDIRECTS[path];
  if (to) return Response.redirect(new URL(to, context.url.origin), 301);
  return next();
}
