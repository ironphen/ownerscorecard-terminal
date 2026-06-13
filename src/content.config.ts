import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Articles are MDX/Markdown files in src/content/articles/.
// Filename becomes the URL: my-piece.mdx → /articles/my-piece
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
