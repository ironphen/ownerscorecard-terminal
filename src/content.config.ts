import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// The "Notes" publication — MDX/Markdown files in src/content/articles/ (the collection id stays
// "articles" to avoid churn and to keep clear of notes.json; the public section lives at /notes).
// Filename becomes the URL: my-piece.mdx → /notes/my-piece
const articles = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/articles" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    // Sections are easy to rename here later; pages read them dynamically
    section: z.enum(["markets", "companies", "principles", "letters"]),
    tickers: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { articles };
