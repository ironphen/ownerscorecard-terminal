# Publishing workflows

## Article

1. Create `src/content/articles/my-piece.mdx` (frontmatter reference:
   `src/content/articles/how-articles-work.mdx`)
2. Keep `draft: true` while writing — drafts render in `npm run dev` only
3. Flip `draft: false`, then:

```sh
git add src/content/articles/my-piece.mdx
git commit -m "Publish: my piece"
git push
```

## Personal results (local analysis only — never published)

The personal record is not part of the site (`EDITORIAL.md`, Track record
policy). To study your own results privately, export the closed-positions
workbook from Fidelity (the one with a `Historical_returns` sheet) and run:

```sh
npm run import:fidelity -- ~/Downloads/Portfolio_Positions_MonDDYYYY.xlsx
```

Outputs land in gitignored paths under `src/data/` and must stay uncommitted.
