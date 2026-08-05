#!/usr/bin/env node
// timelapseTest.mjs — guards the S&P 500 composition record (src/data/sp500-composition.json)
// and the page built from it. The dataset mixes reported figures with reconstructions, so the
// tests here are mostly about not letting the two blur: every estimate must SAY it is one, the
// stated concentration must equal the bars that draw it, and the ranked order must be the order
// the bars actually render in — the animation ranks by weight, so a weight that contradicts its
// listed rank would silently rewrite the claim.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTimelapse } from "./buildTimelapse.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(
  fs.readFileSync(path.join(here, "..", "src", "data", "sp500-composition.json"), "utf8"),
);

let fails = 0;
const ok = (cond, name) => { if (cond) console.log(`  ✓ ${name}`); else { console.error(`  ✗ ${name}`); fails++; } };

console.log("shape:");
{
  ok(data.frames.length >= 10, `${data.frames.length} frames on the record`);
  ok(data.frames.every((f) => f.companies.length === 10), "every frame is a top ten, exactly");
  const years = data.frames.map((f) => f.year);
  ok(years.every((y, i) => i === 0 || y > years[i - 1]), "years run forward, no duplicates");
  ok(years[0] <= 1957, "starts at the index's first year");
  for (const key of ["claim", "weights", "top10Share", "employees", "atoms", "caveat"]) {
    ok(typeof data.methodology[key] === "string" && data.methodology[key].length > 40,
      `methodology documents "${key}"`);
  }
}

console.log("\nweights vs. the ranked order:");
{
  // The renderer sorts by weight and breaks ties on listed position. A weight that is strictly
  // greater than the one above it would put a company on a rank the source never gave it.
  for (const f of data.frames) {
    const w = f.companies.map((c) => c.weight);
    const inversion = w.findIndex((x, i) => i > 0 && x > w[i - 1]);
    ok(inversion === -1,
      `${f.year}: bars render in the listed order` +
      (inversion === -1 ? "" : ` (${f.companies[inversion].name} outranks ${f.companies[inversion - 1].name})`));
  }
}

console.log("\nstated concentration vs. the bars that draw it:");
{
  for (const f of data.frames) {
    const sum = f.companies.reduce((a, c) => a + c.weight, 0);
    ok(Math.abs(sum - f.top10Share) <= 0.05,
      `${f.year}: top ten reads ${f.top10Share}%, bars sum to ${sum.toFixed(1)}%`);
  }
}

console.log("\nprovenance — an estimate must say so:");
{
  for (const f of data.frames) {
    // A total is allowed to stand unflagged only if it is a reported figure that says where it
    // came from. A documented total over an estimated split is the normal case — the individual
    // weights were fitted to the reported total, not the other way round.
    ok(f.top10ShareEst === true || typeof f.top10ShareSource === "string",
      `${f.year}: the total is either flagged estimated or cites its source`);
    ok(!(f.top10ShareEst && f.top10ShareSource),
      `${f.year}: a total is not both estimated and sourced`);
    ok(typeof f.leader.employees === "number" && f.leader.employees > 0,
      `${f.year}: leader carries a headcount`);
    ok(f.companies.every((c) => typeof c.atoms === "boolean"),
      `${f.year}: every name is judged on whether it makes a physical thing`);
    ok(f.companies.every((c) => data.sectors[c.sector]),
      `${f.year}: every sector tag resolves to a legend entry`);
    ok(f.companies.every((c) => typeof c.does === "string" && c.does.length > 2),
      `${f.year}: every name says what it sold`);
  }
  const documented = data.frames.filter((f) => !f.top10ShareEst).map((f) => f.year);
  ok(documented.length >= 3, `${documented.length} frames carry a documented total (${documented.join(", ")})`);
}

console.log("\nthe built page:");
{
  const out = path.join(here, "..", "build", "sp500-timelapse.test.html");
  const html = await buildTimelapse(out);
  ok(!/\/\*__DATA__\*\//.test(html) && !/\/\*__FONTS__\*\//.test(html), "every placeholder is filled");
  ok(!/https?:\/\/[^"')\s]+\.(woff2?|css|js)/.test(html), "no font or script is fetched at view time");
  ok(html.includes("base64"), "fonts are inlined");
  // The data is injected as a JSON string literal; a raw </script> in it would close the tag early.
  const body = html.slice(html.indexOf("<script"));
  ok(body.split("</script>").length === 2, "the data cannot break out of its script tag");
  for (const f of data.frames) ok(html.includes(String(f.year)), `${f.year} reaches the page`);
  fs.rmSync(out, { force: true });
}

console.log(fails ? `\n${fails} failing` : "\nall green");
process.exit(fails ? 1 : 0);
