# AI-Created Categories on Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the Ollama fallback layer finds no existing category that fits a transaction, let it propose a brand-new category name instead of giving up — and only actually create that category (with an auto-generated color and a matching keyword rule) when the user confirms the import, with dedup so two rows proposing the same new name in one batch create exactly one category.

**Architecture:** `parseOllamaResponse`'s result changes from `number | null` to a three-way `CategorySuggestion` (`existing` / `new` / `none`) per description. `previewImport` surfaces a `new` suggestion as `proposedCategoryName` on the candidate (no DB write). A new pure-ish function, `resolveNewCategories`, runs inside `confirmImport` *after* the existing validation pass succeeds — it turns each row's `newCategoryName` into a real `category_id`, creating the category + a keyword rule at most once per distinct name, before handing off to the unchanged `createMany` insert. The frontend shows an editable "New: `<name>`" badge in place of the normal category control for a pending proposal, with a way to pick an existing category instead.

**Tech Stack:** Express 5, `node:sqlite` (`DatabaseSync`), Node's built-in test runner (`node --test`), React 19, Ollama (`gemma4:e4b`).

## Global Constraints

- This branch builds directly on the already-merged `ollamaCategorySuggester.service.ts` (`buildOllamaPrompt`, `parseOllamaResponse`, `suggestCategories`), the `previewImport`/`confirmImport` controllers, `CategoryService`, and `CategoryRuleService`. Don't recreate any of it.
- Backend files are TypeScript run directly by Node — import local files with an explicit `.ts` extension.
- Backend test files that touch `db.ts` set `process.env.DATABASE_FILE = ':memory:'` before the first dynamic `import` of anything that imports it, then use `await import(...)`.
- There is no frontend test framework — frontend verification is `npx tsc -b --noEmit` plus a manual check in the running app.
- Match existing code style: JSDoc-style `/** ... */` comments above exported backend functions/methods; no such comments in frontend `.tsx`/`.ts` files.
- Category creation must only ever happen at **confirm** time, never at preview time — a preview you don't confirm must leave zero trace, same guarantee the rest of this app already gives.
- `confirmImport` validates the *entire* raw batch first (unchanged existing behavior — any invalid row 400s the whole request with nothing written) and only runs `resolveNewCategories` (which has DB side effects: creating categories/rules) after that full-batch validation succeeds. This avoids creating categories for earlier rows in a batch that gets rejected because of a later row.
- `resolveNewCategories`'s category/rule creation is a separate DB operation from `createMany`'s transaction insert (which has its own all-or-nothing `BEGIN`/`COMMIT`/`ROLLBACK`). In the extremely unlikely case `createMany` fails after categories/rules were already created, those rows are not rolled back — accepted as a narrow, low-consequence edge case (an unused category is harmless), not worth a cross-table transaction for.
- Unlike the PDF-dependent `previewImport` (no fixture PDF exists, so its wiring is verified manually), `confirmImport` takes plain JSON and already has HTTP-level tests in `backend/src/routes/transactionsImport.test.ts` — new behavior there gets real HTTP tests, not just manual verification.
- The color palette and its cycling rule are fixed, not configurable: `['#6b9478', '#c06c52', '#c99a3c', '#6c8ebf', '#a65d8f', '#4f9d8f', '#b2622d', '#7a7a9d']`, index = `existingCategoryCount % palette.length` at creation time.

---

### Task 1: `CategorySuggestion` — three-way Ollama resolution

**Files:**
- Modify: `backend/src/services/ollamaCategorySuggester.service.ts`
- Modify: `backend/src/services/ollamaCategorySuggester.service.test.ts`

**Interfaces:**
- Produces: `export type CategorySuggestion = {kind: 'existing', categoryId: number} | {kind: 'new', name: string} | {kind: 'none'}`. `parseOllamaResponse(raw: string, categories: Category[]): Record<string, CategorySuggestion>` and `suggestCategories(descriptions: string[]): Promise<Record<string, CategorySuggestion>>` (signature changes from the existing `Record<string, number | null>`).

- [ ] **Step 1: Update the failing tests**

Replace the three `parseOllamaResponse` tests in `backend/src/services/ollamaCategorySuggester.service.test.ts` that assert on the old `number | null` shape:

```ts
test('parseOllamaResponse resolves a matching category name to an existing suggestion, case-insensitively', () => {
    const result = parseOllamaResponse('{"Walmart Houston TX": "groceries"}', categories);
    assert.deepEqual(result, {'Walmart Houston TX': {kind: 'existing', categoryId: 1}});
});

test('parseOllamaResponse keeps an explicit null as a none suggestion', () => {
    const result = parseOllamaResponse('{"Some Merchant": null}', categories);
    assert.deepEqual(result, {'Some Merchant': {kind: 'none'}});
});

test('parseOllamaResponse treats an unrecognized category name as a proposed new category', () => {
    const result = parseOllamaResponse('{"Some Merchant": "Entertainment"}', categories);
    assert.deepEqual(result, {'Some Merchant': {kind: 'new', name: 'Entertainment'}});
});
```

(The malformed-JSON and non-object-JSON tests, and all three `buildOllamaPrompt` tests, are unchanged — leave them exactly as they are.)

- [ ] **Step 2: Run tests to verify the three updated ones fail**

Run: `cd backend && node --test src/services/ollamaCategorySuggester.service.test.ts`
Expected: FAIL on the 3 updated tests (old implementation still returns `number | null` shaped values); the other 5 tests still pass.

- [ ] **Step 3: Update the implementation**

In `backend/src/services/ollamaCategorySuggester.service.ts`, replace `buildOllamaPrompt`'s closing instruction (the prompt must now invite a new-category proposal instead of forbidding it) and replace `parseOllamaResponse` entirely:

```ts
export function buildOllamaPrompt(descriptions: string[], categories: Category[]): string {
    const uniqueDescriptions = [...new Set(descriptions)];
    const categoryNames = categories.map((c) => c.name);

    return [
        'You are categorizing personal bank transactions for a budgeting app.',
        `Existing categories: ${categoryNames.join(', ')}`,
        'Transaction descriptions to categorize:',
        ...uniqueDescriptions.map((d) => `- ${d}`),
        '',
        'Respond with ONLY a JSON object. Each key must be one of the exact ' +
        'transaction descriptions listed above, verbatim. For each one: if one ' +
        'of the existing categories fits well, use that exact category name as ' +
        'the value. If none of the existing categories fit, propose a short, ' +
        'sensible new category name instead (e.g. "Pet Care", "Home Improvement"). ' +
        'If you genuinely cannot tell what the transaction is for, use null.',
    ].join('\n');
}

export type CategorySuggestion =
    | {kind: 'existing', categoryId: number}
    | {kind: 'new', name: string}
    | {kind: 'none'};

/**
 * Parses the model's JSON response into a description -> CategorySuggestion
 * map. A value matching an existing category (case-insensitively) resolves
 * to {kind: 'existing'}; any other non-empty string is treated as a
 * proposed new category name ({kind: 'new'}) rather than discarded — the
 * caller (resolveNewCategories, confirm-time only) decides whether to
 * actually create it. null, or anything that isn't a non-empty string,
 * resolves to {kind: 'none'}.
 */
export function parseOllamaResponse(raw: string, categories: Category[]): Record<string, CategorySuggestion> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {};
    }

    const result: Record<string, CategorySuggestion> = {};
    for (const [description, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value !== 'string' || value.trim() === '') {
            result[description] = {kind: 'none'};
            continue;
        }
        const match = categories.find((c) => c.name.toLowerCase() === value.toLowerCase());
        result[description] = match
            ? {kind: 'existing', categoryId: match.id}
            : {kind: 'new', name: value.trim()};
    }
    return result;
}
```

Update `suggestCategories`'s return type (its body is otherwise unchanged — the empty-object early returns already satisfy the new type):

```ts
export async function suggestCategories(descriptions: string[]): Promise<Record<string, CategorySuggestion>> {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test src/services/ollamaCategorySuggester.service.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Run the full backend suite and verify the build**

Run: `cd backend && npm test`
Expected: Some failures in `transactionsImport.controller.ts`'s callers are *expected* here — Task 2 fixes `previewImport`'s usage of the now-changed `suggestCategories` return type. Confirm the failures are TypeScript type errors / assertion mismatches only in that file's consumer, not in `ollamaCategorySuggester.service.test.ts` itself.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/ollamaCategorySuggester.service.ts backend/src/services/ollamaCategorySuggester.service.test.ts
git commit -m "Let the Ollama suggester propose a new category, not just pick from existing ones"
```

---

### Task 2: Wire `proposedCategoryName` into `previewImport`

**Files:**
- Modify: `backend/src/controllers/transactionsImport.controller.ts`

**Interfaces:**
- Consumes: `CategorySuggestion` (Task 1).
- Produces: each object in `previewImport`'s response gains `proposedCategoryName: string | null` alongside the existing `category_id`/`isDuplicate`/`aiSuggested`.

No new automated test for this task, per the Global Constraints note (no fixture PDF exists for `previewImport`). Verified manually in Step 2.

- [ ] **Step 1: Update the `withSuggestions` mapping**

In `backend/src/controllers/transactionsImport.controller.ts`, replace:

```ts
    const withSuggestions = withRuleSuggestions.map((t) => {
        if (t.category_id !== null) {
            return {...t, aiSuggested: false};
        }
        const suggested = aiSuggestions[t.description] ?? null;
        return {...t, category_id: suggested, aiSuggested: suggested !== null};
    });
```

with:

```ts
    const withSuggestions = withRuleSuggestions.map((t) => {
        if (t.category_id !== null) {
            return {...t, aiSuggested: false, proposedCategoryName: null};
        }
        const suggestion = aiSuggestions[t.description];
        if (!suggestion || suggestion.kind === 'none') {
            return {...t, aiSuggested: false, proposedCategoryName: null};
        }
        if (suggestion.kind === 'existing') {
            return {...t, category_id: suggestion.categoryId, aiSuggested: true, proposedCategoryName: null};
        }
        return {...t, category_id: null, aiSuggested: true, proposedCategoryName: suggestion.name};
    });
```

- [ ] **Step 2: Manual verification**

With Ollama running (`ollama list` shows `gemma4:e4b`) and at least one existing category that clearly doesn't fit some test description: start the backend and frontend dev servers, upload a statement PDF containing a transaction description that has no history/rule match and doesn't fit any existing category well. Confirm the `previewImport` response (Network tab, or a temporary server-side `console.log(withSuggestions)`) shows `category_id: null`, `aiSuggested: true`, and `proposedCategoryName` set to a plausible new category name for that row. Confirm a row that *does* match an existing category still shows `proposedCategoryName: null` as before.

- [ ] **Step 3: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS (all tests, including Task 1's 8)

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/transactionsImport.controller.ts
git commit -m "Surface a proposed new category name on import preview"
```

---

### Task 3: `resolveNewCategories` — confirm-time creation with dedup

**Files:**
- Create: `backend/src/services/importCategoryResolver.service.ts`
- Test: `backend/src/services/importCategoryResolver.service.test.ts`

**Interfaces:**
- Consumes: `CategoryService` (existing), `CategoryRuleService` (existing), `NewTransaction` (existing).
- Produces: `export type ImportConfirmItem = NewTransaction & {newCategoryName?: string | null}` and `resolveNewCategories(items: ImportConfirmItem[]): NewTransaction[]`.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/importCategoryResolver.service.test.ts`:

```ts
import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_FILE = ':memory:';
const {resolveNewCategories} = await import('./importCategoryResolver.service.ts');
const {CategoryService} = await import('./categories.service.ts');
const {CategoryRuleService} = await import('./categoryRules.service.ts');

const categoryService = new CategoryService();
const categoryRuleService = new CategoryRuleService();

test('creates exactly one category, and one rule per row, when two rows propose the same new name', () => {
    const before = categoryService.getAllCategories().length;

    const result = resolveNewCategories([
        {date: '2026-11-01', description: 'Yarn Barn Austin', amount_cents: -1200, category_id: null, bill_id: null, newCategoryName: 'Hobbies'},
        {date: '2026-11-02', description: 'Yarn Barn Dallas', amount_cents: -800, category_id: null, bill_id: null, newCategoryName: 'Hobbies'},
    ]);

    const afterCategories = categoryService.getAllCategories();
    assert.equal(afterCategories.length, before + 1);
    const created = afterCategories.find((c) => c.name === 'Hobbies')!;
    assert.equal(result[0].category_id, created.id);
    assert.equal(result[1].category_id, created.id);

    const rules = categoryRuleService.getAllCategoryRules().filter((r) => r.category_id === created.id);
    assert.equal(rules.length, 2);
    assert.ok(rules.some((r) => r.pattern === 'Yarn Barn Austin'));
    assert.ok(rules.some((r) => r.pattern === 'Yarn Barn Dallas'));
});

test('reuses an existing category case-insensitively instead of creating a duplicate', () => {
    const existing = categoryService.createCategory({name: 'Dining Resolver Test', color: '#c06c52'});
    const before = categoryService.getAllCategories().length;

    const result = resolveNewCategories([
        {date: '2026-11-03', description: 'Some Diner', amount_cents: -500, category_id: null, bill_id: null, newCategoryName: 'dining resolver test'},
    ]);

    assert.equal(categoryService.getAllCategories().length, before);
    assert.equal(result[0].category_id, existing.id);
});

test('leaves a row with an already-resolved category_id untouched, ignoring any stray newCategoryName', () => {
    const category = categoryService.createCategory({name: 'Already Set Test', color: '#c99a3c'});
    const before = categoryService.getAllCategories().length;

    const result = resolveNewCategories([
        {date: '2026-11-04', description: 'Already Categorized', amount_cents: -300, category_id: category.id, bill_id: null, newCategoryName: 'Should Be Ignored'},
    ]);

    assert.equal(categoryService.getAllCategories().length, before);
    assert.equal(result[0].category_id, category.id);
});

test('leaves a row with no newCategoryName untouched', () => {
    const result = resolveNewCategories([
        {date: '2026-11-05', description: 'Still Uncategorized', amount_cents: -100, category_id: null, bill_id: null},
    ]);
    assert.equal(result[0].category_id, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test src/services/importCategoryResolver.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/importCategoryResolver.service.ts`:

```ts
import {CategoryService} from "./categories.service.ts";
import {CategoryRuleService} from "./categoryRules.service.ts";
import type {NewTransaction} from "../types/transaction.ts";

const COLOR_PALETTE = [
    '#6b9478', '#c06c52', '#c99a3c', '#6c8ebf', '#a65d8f', '#4f9d8f', '#b2622d', '#7a7a9d',
];

export type ImportConfirmItem = NewTransaction & {newCategoryName?: string | null};

const categoryService = new CategoryService();
const categoryRuleService = new CategoryRuleService();

/**
 * Resolves any `newCategoryName` proposed on an import-confirm batch into a
 * real category_id. Creates the category (with an auto-assigned color) and
 * always a matching keyword rule for that row's description, at most once
 * per distinct normalized name per batch — reusing an existing category
 * when the name matches one case-insensitively, and reusing an
 * already-resolved-this-batch category when multiple rows propose the same
 * new name. Rows without `newCategoryName`, or with `category_id` already
 * set, pass through unchanged. Must only be called after the batch has
 * already passed full validation — it has DB side effects.
 */
export function resolveNewCategories(items: ImportConfirmItem[]): NewTransaction[] {
    const resolvedByNormalizedName = new Map<string, number>();

    return items.map(({newCategoryName, ...t}) => {
        if (t.category_id !== null) {
            return t;
        }
        if (!newCategoryName || newCategoryName.trim() === '') {
            return t;
        }

        const normalized = newCategoryName.trim().toLowerCase();
        let categoryId = resolvedByNormalizedName.get(normalized);

        if (categoryId === undefined) {
            const existing = categoryService.getAllCategories().find((c) => c.name.toLowerCase() === normalized);
            if (existing) {
                categoryId = existing.id;
            } else {
                const color = COLOR_PALETTE[categoryService.getAllCategories().length % COLOR_PALETTE.length];
                categoryId = categoryService.createCategory({name: newCategoryName.trim(), color}).id;
            }
            resolvedByNormalizedName.set(normalized, categoryId);
        }

        categoryRuleService.createCategoryRule({pattern: t.description, category_id: categoryId});

        return {...t, category_id: categoryId};
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test src/services/importCategoryResolver.service.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/importCategoryResolver.service.ts backend/src/services/importCategoryResolver.service.test.ts
git commit -m "Add resolveNewCategories: confirm-time category+rule creation with dedup"
```

---

### Task 4: Wire `resolveNewCategories` into `confirmImport`

**Files:**
- Modify: `backend/src/controllers/transactionsImport.controller.ts`
- Modify: `backend/src/routes/transactionsImport.test.ts`

**Interfaces:**
- Consumes: `resolveNewCategories`, `ImportConfirmItem` (Task 3).

- [ ] **Step 1: Write the failing HTTP test**

Append to `backend/src/routes/transactionsImport.test.ts`:

```ts
test('creates a new category and a matching rule when a row proposes newCategoryName with no category_id', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/transactions/import`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({
                transactions: [
                    {
                        date: '2026-11-01', description: 'Yarn Barn Austin', amount_cents: -1200,
                        category_id: null, bill_id: null, newCategoryName: 'Hobbies HTTP Test',
                    },
                ],
            }),
        });
        assert.equal(res.status, 201);

        const categoriesRes = await fetch(`${url}/api/v1/categories`, {headers: {Cookie: cookie}});
        const {data: categories} = await categoriesRes.json();
        const created = categories.find((c: {name: string}) => c.name === 'Hobbies HTTP Test');
        assert.ok(created);

        const rulesRes = await fetch(`${url}/api/v1/category-rules`, {headers: {Cookie: cookie}});
        const {data: rules} = await rulesRes.json();
        assert.ok(rules.some((r: {pattern: string, category_id: number}) =>
            r.pattern === 'Yarn Barn Austin' && r.category_id === created.id
        ));
    } finally {
        await close();
    }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --test src/routes/transactionsImport.test.ts`
Expected: FAIL — the created category is never found (import still writes `category_id: null` since `newCategoryName` isn't wired up yet).

- [ ] **Step 3: Wire it into `confirmImport`**

In `backend/src/controllers/transactionsImport.controller.ts`, add the import:

```ts
import {resolveNewCategories} from '../services/importCategoryResolver.service.ts';
import type {ImportConfirmItem} from '../services/importCategoryResolver.service.ts';
```

Replace the body of `confirmImport`:

```ts
export function confirmImport(req: Request, res: Response) {
    const body = req.body?.transactions;

    if (!Array.isArray(body)) {
        return res.status(400).json({error: 'transactions must be an array'});
    }

    const validated: NewTransaction[] = [];
    for (const item of body) {
        const result = validateTransaction(item);
        if (!result.ok) {
            return res.status(400).json({error: result.error});
        }
        validated.push(result.value as NewTransaction);
    }

    const withNewCategoryNames: ImportConfirmItem[] = validated.map((t, i) => ({
        ...t,
        newCategoryName: body[i]?.newCategoryName,
    }));
    const resolved = resolveNewCategories(withNewCategoryNames);

    const created = transactionService.createMany(resolved);
    return res.status(201).json({data: {created: created.length}});
}
```

(Validation still runs over the full raw batch first, exactly as before — `resolveNewCategories`, which has DB side effects, only runs once that whole-batch validation has already succeeded, per the Global Constraints note.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --test src/routes/transactionsImport.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/transactionsImport.controller.ts backend/src/routes/transactionsImport.test.ts
git commit -m "Create the proposed category and rule when confirming an import"
```

---

### Task 5: Frontend — editable "New: ..." badge

**Files:**
- Modify: `frontend/src/types/transaction.ts`
- Modify: `frontend/src/services/ImportApiService.ts`
- Create: `frontend/src/rules/NewCategoryBadge.tsx`
- Create: `frontend/src/rules/NewCategoryBadge.css`
- Modify: `frontend/src/import/Import.tsx`

**Interfaces:**
- Consumes: `previewImport`'s now-richer response (Task 2), `confirmImport`'s now-richer request shape (Task 4).
- Produces: `ImportCandidate` gains `proposedCategoryName: string | null`. `ImportConfirmItem` (frontend copy, distinct from the backend type of the same name) is `NewTransaction & {newCategoryName?: string}`. `NewCategoryBadge` component with props `{name: string, onRename: (name: string) => void, onPickExisting: () => void}`.

- [ ] **Step 1: Extend the shared types**

In `frontend/src/types/transaction.ts`, change:

```ts
export type ImportCandidate = NewTransaction & {isDuplicate: boolean; aiSuggested: boolean};
```

to:

```ts
export type ImportCandidate = NewTransaction & {
    isDuplicate: boolean;
    aiSuggested: boolean;
    proposedCategoryName: string | null;
};

export type ImportConfirmItem = NewTransaction & {newCategoryName?: string};
```

- [ ] **Step 2: Update `ImportApiService`**

In `frontend/src/services/ImportApiService.ts`, change the import and the `confirmImport` signature:

```ts
import type {ImportCandidate, ImportConfirmItem} from "../types/transaction.ts";
```

```ts
    /**
     * Validates and inserts a confirmed batch of transactions.
     *
     * @return The number of transactions created.
     */
    async confirmImport(transactions: ImportConfirmItem[]): Promise<number> {
        try {
            const res = await this.http.post<ApiResponse<{created: number}>>(
                '/transactions/import', {transactions}
            );
            return res.data.data.created;
        } catch (error) {
            if (axios.isAxiosError<ApiErrorBody>(error)) {
                throw new Error(error.response?.data?.error ?? error.message, {cause: error});
            }
            throw error;
        }
    }
```

(Remove the now-redundant separate `import type {NewTransaction} from "../types/transaction.ts";` line if `NewTransaction` isn't used elsewhere in this file — check with a search; if it's still referenced elsewhere in the file, leave that import alone.)

- [ ] **Step 3: Create the badge component**

Create `frontend/src/rules/NewCategoryBadge.tsx`:

```tsx
import {useState} from "react";
import './NewCategoryBadge.css'

type Props = {
    name: string;
    onRename: (name: string) => void;
    onPickExisting: () => void;
};

/**
 * Shown on an import row where the AI proposed a brand-new category (no
 * existing category fit well). Lets the user rename it before confirming,
 * or fall back to picking a real existing category instead. Nothing is
 * created yet — this is preview-only until the import is confirmed.
 */
function NewCategoryBadge({name, onRename, onPickExisting}: Props) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(name);

    function save() {
        if (value.trim() === '') {
            return;
        }
        onRename(value.trim());
        setEditing(false);
    }

    if (editing) {
        return (
            <span className="new-category-editor">
                <input
                    type="text"
                    className="new-category-input"
                    autoFocus
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            save();
                        } else if (e.key === 'Escape') {
                            setValue(name);
                            setEditing(false);
                        }
                    }}
                />
                <button type="button" onClick={save}>Save</button>
                <button type="button" onClick={() => { setValue(name); setEditing(false); }}>Cancel</button>
            </span>
        );
    }

    return (
        <span className="new-category-badge">
            <button type="button" className="new-category-name" onClick={() => setEditing(true)}>
                New: {name}
            </button>
            <button type="button" className="new-category-pick-existing" onClick={onPickExisting}>
                pick existing instead
            </button>
        </span>
    );
}

export default NewCategoryBadge
```

- [ ] **Step 4: Create the badge styles**

Create `frontend/src/rules/NewCategoryBadge.css`:

```css
.new-category-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.new-category-name {
  font-family: var(--mono);
  font-size: 0.72rem;
  letter-spacing: 0.03em;
  color: var(--credit-dim);
  background: none;
  border: 1px solid var(--rule-on-paper);
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  cursor: pointer;
  white-space: nowrap;
}

.new-category-name:hover,
.new-category-name:focus-visible {
  border-color: var(--text-on-paper);
}

.new-category-pick-existing {
  font-family: var(--mono);
  font-size: 0.68rem;
  color: var(--text-on-paper-dim);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  white-space: nowrap;
}

.new-category-pick-existing:hover,
.new-category-pick-existing:focus-visible {
  color: var(--text-on-paper);
  text-decoration: underline;
}

.new-category-editor {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.new-category-input {
  font-family: var(--mono);
  font-size: 0.72rem;
  border: 1px solid var(--rule-on-paper);
  border-radius: 4px;
  padding: 0.1rem 0.4rem;
  min-width: 10rem;
}
```

- [ ] **Step 5: Wire it into `Import.tsx`**

In `frontend/src/import/Import.tsx`, add the import:

```tsx
import NewCategoryBadge from "../rules/NewCategoryBadge.tsx";
```

Update `toNewTransaction` to include `newCategoryName` and use the new return type:

```tsx
function toNewTransaction({selected, isDuplicate, proposedCategoryName, ...t}: Candidate): ImportConfirmItem {
    return proposedCategoryName ? {...t, newCategoryName: proposedCategoryName} : t;
}
```

(Update the `import type {ImportCandidate, NewTransaction}` line to also bring in `ImportConfirmItem`:)

```tsx
import type {ImportCandidate, ImportConfirmItem, NewTransaction} from "../types/transaction.ts";
```

Update `updateCandidateCategory` to also clear `proposedCategoryName` when a real category is picked:

```tsx
    function updateCandidateCategory(index: number, value: string) {
        const category_id = value === '' ? null : Number(value);
        setCandidates((prev) => prev.map((c, i) =>
            i === index ? {...c, category_id, aiSuggested: false, proposedCategoryName: null} : c
        ));
        setEditingCategoryFor(null);
    }
```

Add two new handlers right after it:

```tsx
    function updateProposedCategoryName(index: number, name: string) {
        setCandidates((prev) => prev.map((c, i) => i === index ? {...c, proposedCategoryName: name} : c));
    }

    function pickExistingInstead(index: number) {
        setCandidates((prev) => prev.map((c, i) => i === index ? {...c, proposedCategoryName: null} : c));
        setEditingCategoryFor(index);
    }
```

Replace the category-control block (the `{editingCategoryFor === i ? (...) : (...)}` ternary) with a three-way check:

```tsx
                                    {c.proposedCategoryName && editingCategoryFor !== i ? (
                                        <NewCategoryBadge
                                            name={c.proposedCategoryName}
                                            onRename={(name) => updateProposedCategoryName(i, name)}
                                            onPickExisting={() => pickExistingInstead(i)}
                                        />
                                    ) : editingCategoryFor === i ? (
                                        <select
                                            className="ledger-category-select"
                                            autoFocus
                                            value={c.category_id ?? ''}
                                            onChange={(e) => updateCandidateCategory(i, e.target.value)}
                                            onBlur={() => setEditingCategoryFor(null)}
                                        >
                                            <option value="">Uncategorized</option>
                                            {categories.map((cat) => (
                                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <button
                                            type="button"
                                            className="ledger-category ledger-category-button"
                                            onClick={() => setEditingCategoryFor(i)}
                                        >
                                            {categoryName(categories, c.category_id)}
                                        </button>
                                    )}
```

- [ ] **Step 6: Verify it compiles**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 7: End-to-end manual verification**

With Ollama running and at least one real category that won't fit some test merchant well: upload a statement PDF with a never-seen transaction. Confirm the row shows a "New: `<name>`" badge instead of the normal category control. Click it, rename it, confirm it updates. Click "pick existing instead" and confirm it switches to the normal dropdown with `Uncategorized` selected and the badge gone. Re-open that row and set a proposed name again, then click "Import" — confirm the import succeeds, a new category with that name now exists on the Categories page with some auto-assigned color, and a rule with that transaction's exact description now exists on the Rules page pointing at it. Re-upload the same statement and confirm that row now gets categorized via the rule (fast path) instead of showing a "New: ..." badge or needing the AI again.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types/transaction.ts frontend/src/services/ImportApiService.ts frontend/src/rules/NewCategoryBadge.tsx frontend/src/rules/NewCategoryBadge.css frontend/src/import/Import.tsx
git commit -m "Show an editable New-category badge and wire it through to import confirm"
```
