// Compact serialization for the generated data files. The pipeline is $0 and git-based: the data is
// committed to the repo and served as static JSON, so the file size that matters is the one GitHub
// accepts in a push (a 100 MB hard limit; a warning past 50 MB). As the universe and the data layers
// grow, the pretty-printed files climb toward that ceiling — fundamentals.json alone was 62 MB — and a
// failed push would silently break the self-maintaining refresh. So the generated files are written
// compact: null and undefined fields are dropped, and the indentation is removed.
//
// This is LOSSLESS to every consumer. No render path distinguishes a null field from an absent one —
// every access is `x ?? default` or `x != null` — and the field-level carry-over reads back only the
// keys that are present, which is exactly the set with a value worth carrying. Stripping nulls removes
// ~38% of all fields (most companies carry many line items that don't apply to them); together with
// dropping indentation it cuts the largest files about 60%, restoring years of headroom. The small,
// human-read files (universe, wire, rates) keep their pretty form; only the heavy machine-read data
// uses this.

export function stripNulls(value) {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      const v = value[k];
      if (v === null || v === undefined) continue;
      out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}

// The string to write: null-stripped, minified, trailing newline. Use with the existing tmp+rename
// atomic-write so a crash mid-write can never leave a truncated file the next run fails to parse.
export function compactJson(obj) {
  return JSON.stringify(stripNulls(obj)) + "\n";
}
