# Local-LLM (Ollama) Import Category Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When neither exact-description history nor keyword category rules can suggest a category for an import candidate, ask a locally-running Ollama model to guess one from the transaction's description and the user's existing category list — so a never-before-seen merchant still gets an automatic suggestion instead of landing as `Uncategorized`.

**Architecture:** A new `services/ollamaCategorySuggester.service.ts` exposes two pure, unit-tested functions (`buildOllamaPrompt`, `parseOllamaResponse`) plus one untested I/O function (`suggestCategories`) that batches every still-unmatched description in an import into a single `fetch` call to `http://localhost:11434/api/chat`. `previewImport` calls it as a third fallback, after history-match and rule-match, only for rows still `null`. Any failure (Ollama not running, timeout, bad JSON) silently resolves to no suggestions — import must keep working exactly as it does today without this layer. The frontend marks AI-guessed rows with a small "AI guess" badge that disappears once the user touches that row's category.

**Tech Stack:** Express 5, `node:sqlite` (`DatabaseSync`), Node's built-in test runner (`node --test`), Node's global `fetch`/`AbortController`, React 19, Ollama (`gemma4:e4b`, already pulled locally).

## Global Constraints

- This branch builds on top of the already-merged keyword-category-rules work (`CategoryRuleService`, `category_rules` table, the `previewImport` history→rule fallback) and the already-merged `SaveAsRuleButton` component. Don't recreate any of it.
- Backend files are TypeScript run directly by Node — import local files with an explicit `.ts` extension.
- Every backend test file that touches `db.ts` sets `process.env.DATABASE_FILE = ':memory:'` before the first dynamic `import` of anything that imports it, then uses `await import(...)`. The tests in this plan are pure-function tests with no DB involved, so this pattern does not apply to them — do not add it where it isn't needed.
- There is no frontend test framework in this repo. Frontend verification is a TypeScript build check (`npx tsc -b --noEmit`) plus a manual check in the running app.
- Match existing code style: JSDoc-style `/** ... */` comments above exported backend functions/methods; no such comments in frontend `.tsx`/`.ts` files.
- No new HTTP-level test for `previewImport`'s fallback wiring itself — same convention as the already-merged history-match and rule-match wiring (no fixture PDF exists). Verified manually instead.
- `suggestCategories` (the actual network call) is not unit tested — only `buildOllamaPrompt` and `parseOllamaResponse`, the pure logic around it, same precedent as leaving the live wiring untested elsewhere in this controller.
- Model and endpoint are hardcoded (`gemma4:e4b`, `http://localhost:11434`) — no settings UI, no env var override, per the approved spec's "out of scope" list.
- Manual verification requires Ollama actually running locally with `gemma4:e4b` pulled (confirm with `ollama list` — it's already present on this machine) for the "working" case, and Ollama stopped for the "failure is silent" case.

---

### Task 1: Ollama prompt builder and response parser (pure functions)

**Files:**
- Create: `backend/src/services/ollamaCategorySuggester.service.ts`
- Test: `backend/src/services/ollamaCategorySuggester.service.test.ts`

**Interfaces:**
- Consumes: `Category` type (existing, `backend/src/types/category.ts`).
- Produces: `buildOllamaPrompt(descriptions: string[], categories: Category[]): string` and `parseOllamaResponse(raw: string, categories: Category[]): Record<string, number | null>`, both exported from `ollamaCategorySuggester.service.ts`. Task 2 adds `suggestCategories` to this same file, consuming both.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/ollamaCategorySuggester.service.test.ts`:

```ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildOllamaPrompt, parseOllamaResponse} from './ollamaCategorySuggester.service.ts';
import type {Category} from '../types/category.ts';

const categories: Category[] = [
    {id: 1, name: 'Groceries', color: '#6b9478'},
    {id: 2, name: 'Dining', color: '#c06c52'},
];

test('buildOllamaPrompt includes every category name', () => {
    const prompt = buildOllamaPrompt(['Walmart Houston TX'], categories);
    assert.ok(prompt.includes('Groceries'));
    assert.ok(prompt.includes('Dining'));
});

test('buildOllamaPrompt includes every description', () => {
    const prompt = buildOllamaPrompt(['Walmart Houston TX', 'Chipotle Mexican Grill'], categories);
    assert.ok(prompt.includes('Walmart Houston TX'));
    assert.ok(prompt.includes('Chipotle Mexican Grill'));
});

test('buildOllamaPrompt dedupes repeated descriptions', () => {
    const prompt = buildOllamaPrompt(['Walmart Houston TX', 'Walmart Houston TX'], categories);
    const occurrences = prompt.split('Walmart Houston TX').length - 1;
    assert.equal(occurrences, 1);
});

test('parseOllamaResponse resolves a valid category name to its id, case-insensitively', () => {
    const result = parseOllamaResponse('{"Walmart Houston TX": "groceries"}', categories);
    assert.deepEqual(result, {'Walmart Houston TX': 1});
});

test('parseOllamaResponse keeps an explicit null as null', () => {
    const result = parseOllamaResponse('{"Some Merchant": null}', categories);
    assert.deepEqual(result, {'Some Merchant': null});
});

test('parseOllamaResponse resolves an unknown/hallucinated category name to null', () => {
    const result = parseOllamaResponse('{"Some Merchant": "Entertainment"}', categories);
    assert.deepEqual(result, {'Some Merchant': null});
});

test('parseOllamaResponse returns an empty object for malformed JSON', () => {
    const result = parseOllamaResponse('not json at all', categories);
    assert.deepEqual(result, {});
});

test('parseOllamaResponse returns an empty object for a non-object JSON value', () => {
    const result = parseOllamaResponse('["Groceries", "Dining"]', categories);
    assert.deepEqual(result, {});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test src/services/ollamaCategorySuggester.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/services/ollamaCategorySuggester.service.ts`:

```ts
import type {Category} from "../types/category.ts";

/**
 * Builds the prompt sent to the local Ollama model, listing the user's
 * existing categories and the (deduplicated) transaction descriptions that
 * still need a category guessed, after exact-history and keyword-rule
 * matching already came up empty for them.
 */
export function buildOllamaPrompt(descriptions: string[], categories: Category[]): string {
    const uniqueDescriptions = [...new Set(descriptions)];
    const categoryNames = categories.map((c) => c.name);

    return [
        'You are categorizing personal bank transactions for a budgeting app.',
        `Allowed categories (choose only from this exact list): ${categoryNames.join(', ')}`,
        'Transaction descriptions to categorize:',
        ...uniqueDescriptions.map((d) => `- ${d}`),
        '',
        'Respond with ONLY a JSON object. Each key must be one of the exact ' +
        'transaction descriptions listed above, verbatim. Each value must be ' +
        'exactly one of the allowed category names, or null if none of them ' +
        'fit well. Do not invent category names that are not in the list.',
    ].join('\n');
}

/**
 * Parses the model's JSON response into a description -> category_id map.
 * Any value that isn't an exact (case-insensitive) match for one of the
 * user's real categories resolves to null rather than throwing — this is a
 * best-effort suggestion, not a trusted data source, so a hallucinated or
 * malformed answer degrades to "no suggestion" instead of corrupting data.
 */
export function parseOllamaResponse(raw: string, categories: Category[]): Record<string, number | null> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {};
    }

    const result: Record<string, number | null> = {};
    for (const [description, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value !== 'string') {
            result[description] = null;
            continue;
        }
        const match = categories.find((c) => c.name.toLowerCase() === value.toLowerCase());
        result[description] = match?.id ?? null;
    }
    return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test src/services/ollamaCategorySuggester.service.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/ollamaCategorySuggester.service.ts backend/src/services/ollamaCategorySuggester.service.test.ts
git commit -m "Add Ollama prompt builder and response parser"
```

---

### Task 2: `suggestCategories` network call and `previewImport` wiring

**Files:**
- Modify: `backend/src/services/ollamaCategorySuggester.service.ts`
- Modify: `backend/src/controllers/transactionsImport.controller.ts`

**Interfaces:**
- Consumes: `buildOllamaPrompt`, `parseOllamaResponse` (Task 1), `CategoryService.getAllCategories()` (existing), `TransactionService.findRecentCategoryForDescription` and `CategoryRuleService.findCategoryForDescription` (already merged).
- Produces: `suggestCategories(descriptions: string[]): Promise<Record<string, number | null>>`, exported from `ollamaCategorySuggester.service.ts`. `previewImport`'s response objects gain an `aiSuggested: boolean` field alongside the existing `category_id`/`isDuplicate`.

No new automated test for this task, per the Global Constraints note — verified manually in Step 3 below.

- [ ] **Step 1: Add `suggestCategories` to the service file**

Append to `backend/src/services/ollamaCategorySuggester.service.ts` (keep the two functions from Task 1 above this):

```ts
import {CategoryService} from "./categories.service.ts";

const OLLAMA_URL = 'http://localhost:11434';
const OLLAMA_MODEL = 'gemma4:e4b';
const TIMEOUT_MS = 15_000;

const categoryService = new CategoryService();

/**
 * Asks the local Ollama model to guess a category for each description that
 * neither exact-history nor keyword-rule matching could resolve. Entirely
 * best-effort: any failure (Ollama not running, timeout, a bad or malformed
 * response) resolves to an empty map rather than throwing, so import keeps
 * working exactly as it does without this layer.
 */
export async function suggestCategories(descriptions: string[]): Promise<Record<string, number | null>> {
    if (descriptions.length === 0) {
        return {};
    }

    const categories = categoryService.getAllCategories();
    if (categories.length === 0) {
        return {};
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                format: 'json',
                stream: false,
                messages: [{role: 'user', content: buildOllamaPrompt(descriptions, categories)}],
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            return {};
        }

        const body = await response.json() as {message?: {content?: string}};
        if (!body.message?.content) {
            return {};
        }

        return parseOllamaResponse(body.message.content, categories);
    } catch {
        return {};
    } finally {
        clearTimeout(timeout);
    }
}
```

Move the `import type {Category} ...` line from Task 1 to the top of the file alongside the new `CategoryService` import if your editor reorders them — both must be present:

```ts
import type {Category} from "../types/category.ts";
import {CategoryService} from "./categories.service.ts";
```

- [ ] **Step 2: Wire the fallback into `previewImport`**

In `backend/src/controllers/transactionsImport.controller.ts`, add the import and instantiate nothing new (it's a function import, not a class):

```ts
import type {Request, Response} from 'express';
import {parseCashAppStatementPdf} from '../services/cashAppStatementParser.ts';
import {validateTransaction} from '../helpers/transactionValidation.ts';
import {TransactionService} from '../services/transactions.service.ts';
import {CategoryRuleService} from '../services/categoryRules.service.ts';
import {suggestCategories} from '../services/ollamaCategorySuggester.service.ts';
import type {NewTransaction} from '../types/transaction.ts';

const transactionService = new TransactionService();
const categoryRuleService = new CategoryRuleService();
```

Replace the `withSuggestions` block with:

```ts
    const withRuleSuggestions = transactions.map((t) => ({
        ...t,
        category_id: transactionService.findRecentCategoryForDescription(t.description)
            ?? categoryRuleService.findCategoryForDescription(t.description),
        isDuplicate: transactionService.existsSimilar(t.date, t.description, t.amount_cents),
    }));

    const unmatchedDescriptions = withRuleSuggestions
        .filter((t) => t.category_id === null)
        .map((t) => t.description);
    const aiSuggestions = await suggestCategories(unmatchedDescriptions);

    const withSuggestions = withRuleSuggestions.map((t) => {
        if (t.category_id !== null) {
            return {...t, aiSuggested: false};
        }
        const suggested = aiSuggestions[t.description] ?? null;
        return {...t, category_id: suggested, aiSuggested: suggested !== null};
    });
```

(`previewImport` is already `async` and already `await`s `parseCashAppStatementPdf`, so adding another `await` above needs no other signature change.)

- [ ] **Step 3: Manual verification**

Confirm Ollama is up and has the model:

Run: `ollama list`
Expected: `gemma4:e4b` appears in the list. If Ollama isn't running, start it (e.g. `ollama serve` in another terminal, or however it's normally running on this machine).

Start the backend (`cd backend && npm run dev`) and frontend (`cd frontend && npm run dev`) if not already running. In the running app: create at least one category (e.g. "Groceries") on the Categories page if none exist. Go to Import and upload a statement PDF containing a transaction whose description doesn't match any existing transaction history or keyword rule. Confirm the response from `previewImport` (check the Network tab, or temporarily log `withSuggestions` server-side) shows a non-null `category_id` and `aiSuggested: true` for that row, with a category name that's actually one of your real categories.

Then stop Ollama (or block port 11434) and repeat the same import. Confirm the request still completes successfully (200 response) with those same rows falling back to `category_id: null, aiSuggested: false` — i.e. identical to today's behavior without this feature, no error surfaced to the user.

- [ ] **Step 4: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: PASS (same tests as Task 1 plus everything already passing before this task — no new automated tests added here)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/ollamaCategorySuggester.service.ts backend/src/controllers/transactionsImport.controller.ts
git commit -m "Fall back to an Ollama category guess when history and rules both miss"
```

---

### Task 3: Frontend `aiSuggested` type, badge, and reset-on-edit

**Files:**
- Modify: `frontend/src/types/transaction.ts`
- Modify: `frontend/src/import/Import.tsx`
- Modify: `frontend/src/import/Import.css`

**Interfaces:**
- Consumes: `ImportCandidate` (existing, being extended), `previewImport`'s now-richer response (Task 2).
- Produces: `ImportCandidate` gains `aiSuggested: boolean`. No other file's exported interface changes.

- [ ] **Step 1: Extend the type**

In `frontend/src/types/transaction.ts`, change:

```ts
export type ImportCandidate = NewTransaction & {isDuplicate: boolean};
```

to:

```ts
export type ImportCandidate = NewTransaction & {isDuplicate: boolean; aiSuggested: boolean};
```

- [ ] **Step 2: Render the badge and reset it on manual edit**

In `frontend/src/import/Import.tsx`, update `updateCandidateCategory` to clear the flag once the user touches that row's category (it's now a confirmed choice, not a guess):

```ts
    function updateCandidateCategory(index: number, value: string) {
        const category_id = value === '' ? null : Number(value);
        setCandidates((prev) => prev.map((c, i) => i === index ? {...c, category_id, aiSuggested: false} : c));
        setEditingCategoryFor(null);
    }
```

Add the badge next to the existing duplicate badge:

```tsx
                                    <span className="ledger-desc">
                                        {c.description}
                                        {c.isDuplicate && (
                                            <span className="import-duplicate-badge">Possible duplicate</span>
                                        )}
                                        {c.aiSuggested && (
                                            <span className="import-ai-badge">AI guess</span>
                                        )}
                                    </span>
```

- [ ] **Step 3: Add the badge style**

Append to `frontend/src/import/Import.css`:

```css
.import-ai-badge {
  margin-left: 0.5rem;
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.03em;
  color: var(--credit-dim);
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 5: End-to-end manual verification**

With Ollama running and at least one category and one AI-guessed row from Task 2's manual check, reload the Import page and re-upload the same statement. Confirm the "AI guess" badge renders next to that row's category. Click the category and change it (or leave it the same) via the dropdown — confirm the badge disappears after that edit. Confirm the "Possible duplicate" badge still renders correctly alongside it when both apply to the same row (e.g. re-importing a statement you already imported, with a row that also happens to be AI-guessed).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/transaction.ts frontend/src/import/Import.tsx frontend/src/import/Import.css
git commit -m "Show an AI guess badge for Ollama-suggested import categories"
```
