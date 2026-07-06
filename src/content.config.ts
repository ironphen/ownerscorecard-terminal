import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// The "Notes" publication — MDX/Markdown files in src/content/articles/ (the collection id stays
// "articles" to avoid churn and to keep clear of notes.json; the public section lives at /notes).
// Filename becomes the URL: my-piece.mdx → /notes/my-piece
const articles = defineCollection({
  // The negation keeps Microsoft Office lock files (~$foo.mdx, created while a piece is open
  // in Word) from being parsed as content entries and failing the build.
  loader: glob({ pattern: ["**/*.{md,mdx}", "!**/~$*"], base: "./src/content/articles" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    // Sections are easy to rename here later; pages read them dynamically
    section: z.enum(["markets", "companies", "principles", "letters"]),
    tickers: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    // The corrections record. When an error in a published note is fixed, the fix is logged here
    // (date + what was wrong and what it is now), rendered at the note's foot, and aggregated on
    // /corrections. The rule that makes this worth anything: NEVER silently fix a published
    // number — log it or don't touch it. Bump `updated` alongside.
    corrections: z.array(z.object({ date: z.coerce.date(), note: z.string() })).default([]),
  }),
});

export const collections = { articles };
