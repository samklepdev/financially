# AI-created categories on import — design

**Status:** approved, ready for implementation plan
**Context:** [[2026-11-11-ollama-import-categorization-design]] added a third
fallback layer — an Ollama model guesses a category for rows that neither
exact-description history nor keyword rules could resolve — but deliberately
restricted the model to the user's *existing* category list, discarding any
other name as a hallucination. In practice this means true zero-touch
categorization never happens for a brand-new *kind* of merchant if no
existing category fits at all (discovered when the user tested the feature
against an empty categories table). The user wants the model to be able to
propose a brand-new category when nothing existing fits, accepting the
duplicate-category risk that the original design avoided, as long as it's
mitigated with a normalize-and-reuse check rather than left unguarded.

## Signal priority (unchanged)

History match → keyword rule match → Ollama (now: existing-or-new) guess.
Nothing about the first two layers changes.

## Backend: richer Ollama resolution

`parseOllamaResponse`'s return type changes from `Record<string, number |
null>` to `Record<string, CategorySuggestion>`:

```ts
type CategorySuggestion =
    | {kind: 'existing', categoryId: number}
    | {kind: 'new', name: string}
    | {kind: 'none'};
```

The prompt (`buildOllamaPrompt`) is unchanged in spirit — list existing
category names, ask for the best-fitting one per description, or `null` if
nothing fits. Resolution in `parseOllamaResponse` changes:

- `null` → `{kind: 'none'}` (unchanged).
- A non-empty string matching an existing category case-insensitively
  (trimmed) → `{kind: 'existing', categoryId}` (unchanged).
- Any other non-empty string → `{kind: 'new', name: value.trim()}` (this is
  the new behavior; previously this case became `null`).
- A non-string, non-null value → `{kind: 'none'}` (unchanged defensive
  handling).

`previewImport` uses the richer result per unmatched row:

- `existing` → `category_id` set, `aiSuggested: true`, `proposedCategoryName: null`.
- `new` → `category_id: null`, `aiSuggested: true`, `proposedCategoryName: name`.
- `none` → `category_id: null`, `aiSuggested: false`, `proposedCategoryName: null`.

`ImportCandidate` gains `proposedCategoryName: string | null`.

## Backend: category creation happens at confirm time, not preview time

Nothing is created in the `categories` table during `previewImport` — a
preview you don't confirm leaves zero trace, same guarantee the rest of this
app already gives (no transactions are written either). Creation happens
inside `confirmImport`.

`confirmImport`'s request body gains an optional `newCategoryName` per
transaction item, alongside the existing `category_id`. Before today's
`validateTransaction`/`createMany` pipeline runs, a new pre-processing step:

1. Build a resolution map, seeded with nothing. Walk the batch in order; for
   each item with `newCategoryName` set and no `category_id`:
   - Normalize the name (trim, lowercase) and check it against (a) all
     existing real categories and (b) names already resolved earlier in
     *this same batch* (the resolution map). If either matches, reuse that
     `category_id` — this is what stops two rows in one import that both
     propose "Hobby Shop" from creating two categories.
   - Otherwise, create a new category: `name` as given (original casing,
     not the normalized form), `color` auto-assigned from a fixed palette
     (below). Add it to the resolution map.
   - Immediately create a keyword rule for that row —
     `CategoryRuleService.createCategoryRule({pattern: item.description,
     category_id: resolvedId})` — same mechanism as the existing
     `SaveAsRuleButton`. This closes the loop: that merchant is rule-matched
     (fast, free, no model call) on every later import.
   - Set `item.category_id = resolvedId` and strip `newCategoryName` from
     the item.
2. Hand the now-fully-normal `NewTransaction[]` batch to the existing
   `validateTransaction`/`createMany` flow unchanged.

**Color palette:** a fixed array of 8 hex colors (reusing ones already seen
in this codebase's test fixtures): `['#6b9478', '#c06c52', '#c99a3c',
'#6c8ebf', '#a65d8f', '#4f9d8f', '#b2622d', '#7a7a9d']`. The color for a
newly-created category is `palette[existingCategoryCount % palette.length]`
at the moment of creation (`existingCategoryCount` = however many categories
exist before this one is inserted) — deterministic, no collision tracking
needed, good enough since colors are cosmetic and always editable afterward
on the Categories page.

## Frontend

- `ImportCandidate` (shared type) gains `proposedCategoryName: string |
  null`.
- `Import.tsx`: a row where `proposedCategoryName` is set shows an editable
  "New: `<name>`" badge instead of the normal category button/dropdown —
  click to rename inline (same text-input + Save/Cancel pattern as
  `SaveAsRuleButton`), plus a small "pick existing instead" link that swaps
  in the normal dropdown and clears `proposedCategoryName`. Choosing a real
  category via the normal dropdown (today's existing behavior, unchanged)
  always clears `proposedCategoryName` if it happened to be set.
- `toNewTransaction` (the mapping to the `confirmImport` request body)
  includes `newCategoryName: c.proposedCategoryName` when it's set.

## Testing

- Unit tests for `parseOllamaResponse`'s three-way resolution (existing by
  exact/case-insensitive name, new for an unrecognized name, none for
  `null`/non-string) — extends the existing test file from the prior
  project.
- Unit tests for the confirm-time resolve-or-create step, extracted as a
  pure-ish function over an in-memory list of "already resolved in this
  batch" names plus a real `CategoryService`/`CategoryRuleService` — direct
  service-level tests (creates two rows proposing the same new name in one
  batch, asserts exactly one category and one rule are created; creates a
  row proposing a name that case-insensitively matches an existing category,
  asserts no new category is created and the existing id is reused).
- No new HTTP-level test for `previewImport`/`confirmImport`'s wiring
  itself — same precedent as the rest of this pipeline. Verified manually:
  import a statement with a transaction with no existing-category fit,
  confirm it shows the "New: ..." badge, rename it, confirm the import,
  verify the category and a matching rule both now exist, re-import the same
  statement and verify the row now gets the keyword-rule match instantly
  (no AI call needed).

## Out of scope

- Any undo/merge UI for AI-created categories — manage them normally on the
  existing Categories page afterward if one needs renaming or merging.
- A confidence threshold or extra confirmation step beyond the editable
  "New: ..." badge itself.
- A cap on how many new categories a single import can create.
- Changing the color palette's values after this ships, or making it
  configurable.
