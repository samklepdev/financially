# Manual transaction entry with Ollama category suggestions — design

**Status:** approved, ready for implementation plan
**Context:** Transactions currently only get into the system via Cash App PDF
import. There's no way to add a one-off transaction by hand. The user wants
a manual-add path that benefits from the same auto-categorization the import
flow already has — [[2026-11-11-ollama-import-categorization-design]]'s
three-layer signal stack (exact-history match, keyword rules, Ollama
fallback) — rather than always landing as `Uncategorized` until hand-fixed.

## Signal priority (same three layers, applied to one description)

1. `TransactionService.findRecentCategoryForDescription(description)`
2. `CategoryRuleService.findCategoryForDescription(description)`
3. Ollama guess via the existing `suggestCategories` — only when 1 and 2
   both return `null`.

This mirrors `previewImport`'s per-row logic exactly, just for a single
description instead of a batch. `previewImport` itself is untouched; batching
multiple descriptions into one Ollama call still matters there and isn't
replicated here (a manual add is always one description at a time).

## Backend

New endpoint: `POST /transactions/suggest-category`, body `{description: string}`.

New handler `suggestCategoryForDescription` in `transactions.controller.ts`:

1. Validate `description` is a non-empty string (400 otherwise).
2. `category_id = transactionService.findRecentCategoryForDescription(description) ?? categoryRuleService.findCategoryForDescription(description)`.
3. If `category_id !== null`, respond `{data: {category_id, aiSuggested: false, proposedCategoryName: null}}`.
4. Otherwise call `suggestCategories([description])` and resolve the single
   entry:
   - missing/`{kind: 'none'}` → `{category_id: null, aiSuggested: false, proposedCategoryName: null}`
   - `{kind: 'existing', categoryId}` → `{category_id: categoryId, aiSuggested: true, proposedCategoryName: null}`
   - `{kind: 'new', name}` → `{category_id: null, aiSuggested: true, proposedCategoryName: name}`
5. Respond 200 with that shape in all cases — this is a best-effort signal,
   not something that fails the request. Ollama being down just means step 4
   resolves to the "none" case, as `suggestCategories` already guarantees.

No changes to `createTransaction`, `validateTransaction`, or the Ollama
service itself. New route added in `transactions.router.ts`.

## Frontend

All new UI lives in `Transactions.tsx` plus one new component:

- An "Add transaction" button above the ledger toggles an inline form shaped
  like a `ledger-row`: date input, description input, amount input,
  category control.
- On blur of the description field — only if it's non-empty and the user
  hasn't already manually picked a category for this draft — call
  `POST /transactions/suggest-category`. While pending, show a small
  "thinking…" indicator. On success, populate the draft's `category_id`,
  `aiSuggested`, and `proposedCategoryName`, reusing the *existing* category
  `<select>`/button, `NewCategoryBadge`, `SaveAsRuleButton`, and `aiSuggested`
  badge styling verbatim from `Transactions.tsx` / `Import.tsx` — no new
  category-picker UI.
- Manually changing the category, or editing the proposed new-category name,
  clears `aiSuggested` on the draft (same rule as import candidates).
- A fetch failure or timeout on the suggest call is silent: the draft simply
  keeps `category_id: null`, same as Ollama returning "none" — consistent
  with `suggestCategories`'s own best-effort contract.
- Submit:
  1. If `proposedCategoryName` is still set (user accepted the AI's proposed
     new category rather than picking an existing one or renaming it away),
     call `categoryApiService.createCategory({name: proposedCategoryName, color: DEFAULT_COLOR})`
     first to get a real `category_id`. `DEFAULT_COLOR` is the same constant
     `Categories.tsx` uses for user-created categories (`#6b9478`) — no new
     color-palette logic.
  2. Call `transactionApiService.createTransaction({date, description, amount_cents, category_id, bill_id: null})`.
  3. On success, prepend the created `Transaction` to local state and
     collapse/reset the form. The new row renders through the same ledger
     row markup as every other transaction, so it automatically gets
     `SaveAsRuleButton` — no special-casing needed.
  4. On failure (validation error, FK error), show the error inline using
     the same `error` state and `ledger-status error` styling already used
     elsewhere on this page.

## Data model

No new tables, no new persisted fields. `category_id` creation (step 1 of
submit) uses the existing `categories` table exactly as `Categories.tsx`'s
manual "add category" flow does.

## Testing

- Unit tests for `suggestCategoryForDescription`'s branching: history-match
  hit, rule-match hit (history empty), Ollama `existing` hit (both empty),
  Ollama `new` hit, Ollama `none`/empty-batch-response. Mirrors the existing
  test style for `ollamaCategorySuggester.service.test.ts` — mock
  `suggestCategories` rather than hitting the network.
- No test for the actual Ollama network call — same precedent as
  `suggestCategories` itself.
- Frontend: `npx tsc -b --noEmit` plus manual check in the running app, both
  with Ollama running and with it stopped (submission must still work with
  no suggestion).

## Out of scope

- A bill picker in the manual-add form. `bill_id` exists on `Transaction`
  and is editable via the API, but no bill-picker UI exists anywhere in the
  app yet (including on the edit path) — not introducing one here. New
  manual transactions are created with `bill_id: null`.
- Bulk/multi-row manual add — one transaction per submit, matching the
  "manually add **a** transaction" request.
- Editing an existing transaction's description to re-trigger a suggestion —
  suggestions only apply to the new-transaction draft.
