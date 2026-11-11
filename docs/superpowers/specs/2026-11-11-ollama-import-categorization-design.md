# Local-LLM (Ollama) import category suggestions — design

**Status:** approved, ready for implementation plan
**Context:** [[2026-11-11-keyword-category-rules-design]] explicitly scoped out
LLM-based categorization, on the grounds that the only way to get automatic
categorization without new infrastructure was a keyword rule table the user
maintains once per merchant. In practice this still means a transaction from
a never-before-seen merchant lands as `Uncategorized` until the user either
hand-categorizes it or writes a rule for it — a manual step the user
explicitly does not want to keep doing. The user wants a third fallback layer:
when neither exact-description history nor keyword rules produce a category,
ask a locally-running Ollama model (`gemma4:e4b`, already pulled) to guess
one from the transaction description and the user's existing category list.
Runs entirely on the user's own machine — no data leaves it, consistent with
the rest of this app's "no cloud" design.

## Signal priority (unchanged order, one new fallback appended)

1. Exact-description history match (`TransactionService.findRecentCategoryForDescription`).
2. Keyword category rules (`CategoryRuleService.findCategoryForDescription`).
3. **New:** Ollama guess — only consulted for rows still `null` after 1 and 2.

A row that already has a category from signal 1 or 2 is never sent to Ollama.

## Backend

New file `backend/src/services/ollamaCategorySuggester.service.ts`, split into
pure/testable logic and a thin I/O call, mirroring how the rest of the import
pipeline separates parsing from matching:

- `buildOllamaPrompt(descriptions: string[], categories: Category[]): string`
  — pure. Lists the user's existing category names and the deduplicated list
  of unmatched descriptions, and instructs the model to respond with a JSON
  object mapping each description (verbatim) to exactly one of the given
  category names, or `null` if none fit well. Categories are never invented —
  the model is restricted to the provided list.
- `parseOllamaResponse(raw: string, categories: Category[]): Record<string, number | null>`
  — pure. Parses the model's JSON response. For each description, resolves
  the returned category name back to a `category_id` via case-insensitive
  exact match against `categories`; anything that doesn't resolve (wrong
  name, hallucinated category, malformed JSON entry) maps to `null` rather
  than throwing. A top-level JSON parse failure returns `{}` (no suggestions
  for anything in that batch).
- `suggestCategories(descriptions: string[]): Promise<Record<string, number | null>>`
  — not unit tested (same precedent as the rest of the import-preview
  wiring). Deduplicates `descriptions`, loads categories via
  `CategoryService`, builds the prompt, and `fetch`es
  `http://localhost:11434/api/chat` with `{model: 'gemma4:e4b', format:
  'json', stream: false, messages: [...]}`. Wrapped in an `AbortController`
  with a 15-second timeout. Any failure — connection refused (Ollama not
  running), timeout, non-200 response, or a parse failure bubbling up from
  `parseOllamaResponse` — is caught and the function resolves to `{}`. This
  is a deliberate silent no-op: the AI layer is a nice-to-have, and import
  must keep working exactly as it does today if Ollama isn't available.

`transactionsImport.controller.ts` — `previewImport` changes:

1. Compute `category_id` for every row using history-match then rule-match,
   same as today.
2. Collect the `description` of every row still `null`.
3. Call `suggestCategories` once with that full list (batched, not per-row).
4. For rows where the batch returned a resolved `category_id`, set it and set
   a new `aiSuggested: true` flag on that candidate. Rows the batch didn't
   cover (Ollama unavailable, or the model returned `null` for that
   description) stay `category_id: null`, `aiSuggested: false`.

## Data model / types

`ImportCandidate` (shared shape returned by `previewImport`) gains one field:

```ts
type ImportCandidate = NewTransaction & {
    isDuplicate: boolean;
    aiSuggested: boolean; // true only when signal 3 (Ollama) produced this category_id
};
```

No new table, no new persisted data — this is a preview-time-only signal,
same lifecycle as `isDuplicate`.

## Frontend

- `types/transaction.ts`: add `aiSuggested: boolean` to `ImportCandidate`.
- `Import.tsx`: when `c.aiSuggested` is true, render a small "AI guess" badge
  next to the category button (same visual family as the existing
  "Possible duplicate" badge). Changing the category — via the existing
  dropdown, or via `SaveAsRuleButton`'s flow — clears `aiSuggested` on that
  row, since it's now a confirmed choice rather than a guess.
- No changes to `Transactions.tsx` or the Rules page — this fallback only
  applies at import time, since that's the only place a category is being
  guessed from scratch rather than edited after the fact.

## Testing

- Unit tests for `buildOllamaPrompt` (prompt includes every unmatched
  description and every category name, dedupes repeated descriptions) and
  `parseOllamaResponse` (valid mapping, unknown/hallucinated category name →
  `null`, malformed JSON → `{}`, explicit `null` value for a description →
  `null`).
- No test for `suggestCategories`'s network call itself or for the
  `previewImport` wiring — consistent with the existing untested
  history-match/rule-match wiring in that controller. Verified manually: with
  Ollama running, with Ollama stopped (import must still complete normally).
- Frontend: `npx tsc -b --noEmit` plus manual check in the running app.

## Out of scope

- Configurable model/endpoint via settings UI — `gemma4:e4b` and
  `http://localhost:11434` are hardcoded for now; revisit if the user wants
  to switch models later.
- Retroactively suggesting categories for existing uncategorized transactions
  outside of the import flow.
- Any network call to a non-local LLM provider.
- Confidence scores or multiple ranked suggestions — one category guess (or
  `null`) per row.
