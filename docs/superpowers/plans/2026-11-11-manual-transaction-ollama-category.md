# Manual Transaction Entry with Ollama Category Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user manually add a single transaction from the Transactions page, with its category auto-suggested by the same three-layer signal stack (exact-history match, keyword rules, local Ollama fallback) already used for import.

**Architecture:** One new backend endpoint (`POST /transactions/suggest-category`) reuses the existing `TransactionService`, `CategoryRuleService`, and `ollamaCategorySuggester.service.ts` to suggest a category for a single description, resolved in the same priority order `previewImport` already uses. The frontend adds an inline `AddTransactionForm` on the Transactions page that calls this endpoint on description blur and reuses the existing category select / `NewCategoryBadge` / badge markup, then creates the category (if a new one was proposed and accepted) and the transaction through the existing, unmodified `categories` and `transactions` CRUD endpoints.

**Tech Stack:** Node 26+, Express 5, `node:sqlite` (`DatabaseSync`), TypeScript run directly by Node, React 19 + Vite + Axios.

## Global Constraints

- No ORM, plain SQL, `STRICT` tables — this plan adds no new tables/columns.
- TypeScript throughout; local imports use explicit `.ts`/`.tsx` extensions.
- Backend tests use Node's built-in test runner (`node --test`). Every test file that touches the DB sets `process.env.DATABASE_FILE = ':memory:'` before the first dynamic `import` of anything touching `db.ts`.
- Backend code style: JSDoc `/** ... */` above exported functions/methods. No such comments in frontend `.tsx`/`.ts` files.
- No frontend test framework — frontend verification is `npx tsc -b --noEmit` plus a manual check in the running app.
- Follow existing patterns exactly rather than introducing new ones (e.g. reuse `ledger-row`/`ledger-category-select`/`NewCategoryBadge`/`import-ai-badge` CSS classes and markup instead of inventing new ones).
- Never test the actual Ollama network call — consistent with existing precedent (`suggestCategories` itself is untested; only its pure/branching logic is).

---

### Task 1: Backend `POST /transactions/suggest-category` endpoint

**Files:**
- Modify: `backend/src/controllers/transactions.controller.ts`
- Modify: `backend/src/routes/transactions.router.ts`
- Test: `backend/src/routes/transactionSuggestCategory.test.ts`

**Interfaces:**
- Consumes: `TransactionService.findRecentCategoryForDescription(description: string): number | null` (existing), `CategoryRuleService.findCategoryForDescription(description: string): number | null` (existing), `suggestCategories(descriptions: string[]): Promise<Record<string, CategorySuggestion>>` (existing, from `backend/src/services/ollamaCategorySuggester.service.ts`, where `CategorySuggestion = {kind: 'existing', categoryId: number} | {kind: 'new', name: string} | {kind: 'none'}`).
- Produces: `suggestCategoryForDescription(req, res)` Express handler, mounted at `POST /api/v1/transactions/suggest-category` (behind `requireAuth`, already applied to the whole router in `app.ts`). Response body on success: `{data: {category_id: number | null, aiSuggested: boolean, proposedCategoryName: string | null}}`. Task 2 and Task 3 depend on this exact response shape.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/routes/transactionSuggestCategory.test.ts`:

```ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword} from '../helpers/password.ts';
import {listen} from '../testHelpers/httpServer.ts';

process.env.DATABASE_FILE = ':memory:';
process.env.APP_PASSWORD_HASH = hashPassword('test-password');

const {default: app} = await import('../app.ts');

async function loginCookie(url: string): Promise<string> {
    const res = await fetch(`${url}/api/v1/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({password: 'test-password'}),
    });
    return res.headers.get('set-cookie')!.split(';')[0];
}

test('the suggest-category endpoint requires authentication', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/transactions/suggest-category`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({description: 'Anything'}),
        });
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('rejects an empty description', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/transactions/suggest-category`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({description: '   '}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('resolves from exact-description history before anything else', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);

        const categoryRes = await fetch(`${url}/api/v1/categories`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Groceries HTTP Test', color: '#6b9478'}),
        });
        const {data: category} = await categoryRes.json();

        await fetch(`${url}/api/v1/transactions`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({
                date: '2026-10-01', description: 'Trader Joes Suggest Test', amount_cents: -4200,
                category_id: category.id, bill_id: null,
            }),
        });

        const res = await fetch(`${url}/api/v1/transactions/suggest-category`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({description: 'Trader Joes Suggest Test'}),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.deepEqual(body.data, {category_id: category.id, aiSuggested: false, proposedCategoryName: null});
    } finally {
        await close();
    }
});

test('falls back to a keyword rule when there is no history match', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);

        const categoryRes = await fetch(`${url}/api/v1/categories`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Pet Care HTTP Test', color: '#c06c52'}),
        });
        const {data: category} = await categoryRes.json();

        await fetch(`${url}/api/v1/category-rules`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({pattern: 'Petco Suggest Test', category_id: category.id}),
        });

        const res = await fetch(`${url}/api/v1/transactions/suggest-category`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({description: 'Petco Suggest Test Houston TX'}),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.deepEqual(body.data, {category_id: category.id, aiSuggested: false, proposedCategoryName: null});
    } finally {
        await close();
    }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test src/routes/transactionSuggestCategory.test.ts`
Expected: FAIL — `/transactions/suggest-category` doesn't exist yet, so requests 404 and the assertions on status/body don't match (the auth test may pass by coincidence since a 404 isn't 401 either — the other three must fail).

- [ ] **Step 3: Implement the handler**

Modify `backend/src/controllers/transactions.controller.ts`. Change the top imports and service instances:

```ts
import type { Request, Response } from 'express';
import {validateTransaction} from "../helpers/transactionValidation.ts";
import {TransactionService} from "../services/transactions.service.ts";
import {CategoryRuleService} from "../services/categoryRules.service.ts";
import {suggestCategories} from "../services/ollamaCategorySuggester.service.ts";

const transactionService = new TransactionService();
const categoryRuleService = new CategoryRuleService();
```

Add this function at the end of the file, after `deleteTransaction`:

```ts
/**
 * Suggests a category for a transaction description without creating anything,
 * for the manual "add transaction" form. Tries exact-description history, then
 * keyword category rules, then falls back to asking the local Ollama model —
 * the same three-layer signal stack import preview uses, applied to a single
 * description instead of a batch. Always responds 200 with a suggestion object;
 * "no suggestion found" (including Ollama being unreachable) is represented by
 * category_id: null, aiSuggested: false rather than an error.
 *
 * @param req Express request containing the transaction description in the request body.
 * @param res Express response used to return the suggestion or a validation error.
 * @return The HTTP response containing a category_id/aiSuggested/proposedCategoryName suggestion.
 */
export async function suggestCategoryForDescription(req: Request, res: Response) {
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    if (description === '') {
        return res.status(400).json({error: 'description is required'});
    }

    const category_id = transactionService.findRecentCategoryForDescription(description)
        ?? categoryRuleService.findCategoryForDescription(description);

    if (category_id !== null) {
        return res.status(200).json({data: {category_id, aiSuggested: false, proposedCategoryName: null}});
    }

    const suggestions = await suggestCategories([description]);
    const suggestion = suggestions[description];

    if (!suggestion || suggestion.kind === 'none') {
        return res.status(200).json({data: {category_id: null, aiSuggested: false, proposedCategoryName: null}});
    }

    if (suggestion.kind === 'existing') {
        return res.status(200).json({
            data: {category_id: suggestion.categoryId, aiSuggested: true, proposedCategoryName: null},
        });
    }

    return res.status(200).json({
        data: {category_id: null, aiSuggested: true, proposedCategoryName: suggestion.name},
    });
}
```

Modify `backend/src/routes/transactions.router.ts` — add the import and route:

```ts
import express from "express";
import multer from "multer";
import {
    createTransaction, deleteTransaction,
    getAllTransactions,
    getTransactionById,
    suggestCategoryForDescription,
    updateTransaction
} from "../controllers/transactions.controller.ts";
import {previewImport, confirmImport} from "../controllers/transactionsImport.controller.ts";

const upload = multer({storage: multer.memoryStorage(), limits: {fileSize: 10 * 1024 * 1024}});

export const transactionsRouter = express.Router()

transactionsRouter.get('/', getAllTransactions);
transactionsRouter.post('/', createTransaction);
transactionsRouter.post('/suggest-category', suggestCategoryForDescription);
transactionsRouter.post('/import/preview', upload.single('file'), previewImport);
transactionsRouter.post('/import', confirmImport);
transactionsRouter.get('/:id', getTransactionById);
transactionsRouter.put('/:id', updateTransaction);
transactionsRouter.delete('/:id', deleteTransaction);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test src/routes/transactionSuggestCategory.test.ts`
Expected: PASS (4 tests).

Also run the full backend suite to confirm nothing else broke:
Run: `cd backend && node --test`
Expected: all existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/transactions.controller.ts backend/src/routes/transactions.router.ts backend/src/routes/transactionSuggestCategory.test.ts
git commit -m "Add POST /transactions/suggest-category endpoint for manual-add category suggestions"
```

---

### Task 2: Frontend API client support

**Files:**
- Modify: `frontend/src/types/transaction.ts`
- Modify: `frontend/src/services/TransactionApiService.ts`

**Interfaces:**
- Consumes: Task 1's `POST /transactions/suggest-category` response shape `{data: {category_id: number | null, aiSuggested: boolean, proposedCategoryName: string | null}}`.
- Produces: `export type CategorySuggestion` in `frontend/src/types/transaction.ts`, and `transactionApiService.suggestCategory(description: string): Promise<CategorySuggestion>`. Task 3 depends on both.

- [ ] **Step 1: Add the `CategorySuggestion` type**

Modify `frontend/src/types/transaction.ts` — append:

```ts
export type CategorySuggestion = {
    category_id: number | null;
    aiSuggested: boolean;
    proposedCategoryName: string | null;
};
```

- [ ] **Step 2: Add `suggestCategory` to `TransactionApiService`**

Modify `frontend/src/services/TransactionApiService.ts` — update the imports at the top and add the method:

```ts
import axios from "axios";
import type {ApiErrorBody, ApiResponse} from "../types/api.ts";
import {BaseApiService} from "./BaseApiService.ts";
import type {CategorySuggestion, NewTransaction, Transaction} from "../types/transaction.ts";

export class TransactionApiService extends BaseApiService {

    constructor() {
        super('/transactions');
    }
```

(leave the rest of the class body — `getAllTransactions`, `getTransactionById`, `createTransaction`, `updateTransaction`, `deleteTransaction` — unchanged, and add this method among them, e.g. right after `createTransaction`):

```ts
    /**
     * Asks the backend to suggest a category for a transaction description,
     * for the manual add-transaction form. Resolves to {category_id: null,
     * aiSuggested: false, proposedCategoryName: null} when nothing could be
     * suggested — only a genuine request failure (network/auth/server error)
     * rejects.
     *
     * @param description The transaction description to suggest a category for.
     * @return A promise that resolves to the suggested category.
     */
    async suggestCategory(description: string): Promise<CategorySuggestion> {
        try {
            const res = await this.http.post<ApiResponse<CategorySuggestion>>(
                `${this.path}/suggest-category`, {description}
            );
            return res.data.data;
        } catch (error) {
            if (axios.isAxiosError<ApiErrorBody>(error)) {
                throw new Error(error.response?.data?.error ?? error.message, {cause: error});
            }
            throw error;
        }
    }
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/transaction.ts frontend/src/services/TransactionApiService.ts
git commit -m "Add suggestCategory to TransactionApiService"
```

---

### Task 3: AddTransactionForm UI, wired into the Transactions page

**Files:**
- Create: `frontend/src/transactions/AddTransactionForm.tsx`
- Create: `frontend/src/transactions/AddTransactionForm.css`
- Modify: `frontend/src/transactions/Transactions.tsx`
- Modify: `frontend/src/transactions/Transactions.css`

**Interfaces:**
- Consumes: `transactionApiService.suggestCategory` and `transactionApiService.createTransaction` (existing) from Task 2; `categoryApiService.createCategory` (existing, `frontend/src/services/CategoryApiService.ts`); `NewCategoryBadge` (existing, `frontend/src/rules/NewCategoryBadge.tsx`, props `{name: string, onRename: (name: string) => void, onPickExisting: () => void}`); `CategorySuggestion`, `NewTransaction`, `Transaction` types from Task 2/existing code; `Category` type (existing).
- Produces: `AddTransactionForm` default export with props `{categories: Category[], onCreated: (t: Transaction) => void, onCategoryCreated: (c: Category) => void, onCancel: () => void}`. Nothing downstream consumes this beyond the wiring in this same task.

- [ ] **Step 1: Create the form component**

Create `frontend/src/transactions/AddTransactionForm.tsx`:

```tsx
import {useState, type FormEvent} from "react";
import type {Category} from "../types/category.ts";
import type {NewTransaction, Transaction} from "../types/transaction.ts";
import {transactionApiService} from "../services/TransactionApiService.ts";
import {categoryApiService} from "../services/CategoryApiService.ts";
import NewCategoryBadge from "../rules/NewCategoryBadge.tsx";
import "../styles/ledger.css"
import './AddTransactionForm.css'

const DEFAULT_COLOR = '#6b9478';
const EXPENSE = 'expense';
const INCOME = 'income';

function todayDate(): string {
    return new Date().toISOString().slice(0, 10);
}

type Props = {
    categories: Category[];
    onCreated: (t: Transaction) => void;
    onCategoryCreated: (c: Category) => void;
    onCancel: () => void;
};

function AddTransactionForm({categories, onCreated, onCategoryCreated, onCancel}: Props) {
    const [date, setDate] = useState(todayDate());
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [amountType, setAmountType] = useState<typeof EXPENSE | typeof INCOME>(EXPENSE);
    const [categoryId, setCategoryId] = useState<number | null>(null);
    const [proposedCategoryName, setProposedCategoryName] = useState<string | null>(null);
    const [aiSuggested, setAiSuggested] = useState(false);
    const [manuallySet, setManuallySet] = useState(false);
    const [suggesting, setSuggesting] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleDescriptionBlur() {
        if (manuallySet || description.trim() === '') {
            return;
        }
        setSuggesting(true);
        try {
            const suggestion = await transactionApiService.suggestCategory(description.trim());
            setCategoryId(suggestion.category_id);
            setAiSuggested(suggestion.aiSuggested);
            setProposedCategoryName(suggestion.proposedCategoryName);
        } catch {
            setCategoryId(null);
            setAiSuggested(false);
            setProposedCategoryName(null);
        } finally {
            setSuggesting(false);
        }
    }

    function updateCategory(value: string) {
        setCategoryId(value === '' ? null : Number(value));
        setAiSuggested(false);
        setProposedCategoryName(null);
        setManuallySet(true);
    }

    function pickExistingInstead() {
        setProposedCategoryName(null);
        setManuallySet(true);
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();

        const amountValue = Number(amount);
        if (description.trim() === '' || !Number.isFinite(amountValue) || amountValue <= 0) {
            setError('Enter a description and a positive amount');
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            let finalCategoryId = categoryId;
            if (proposedCategoryName) {
                const created = await categoryApiService.createCategory({
                    name: proposedCategoryName, color: DEFAULT_COLOR,
                });
                onCategoryCreated(created);
                finalCategoryId = created.id;
            }

            const amount_cents = Math.round(amountValue * 100) * (amountType === EXPENSE ? -1 : 1);
            const newTransaction: NewTransaction = {
                date, description: description.trim(), amount_cents, category_id: finalCategoryId, bill_id: null,
            };
            const created = await transactionApiService.createTransaction(newTransaction);
            onCreated(created);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not create this transaction');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form className="ledger-row add-transaction-form" onSubmit={handleSubmit}>
            <div className="ledger-row__main add-transaction-fields">
                <input
                    type="date"
                    className="add-transaction-date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                />
                <input
                    type="text"
                    className="add-transaction-description"
                    placeholder="Description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={handleDescriptionBlur}
                    required
                />
                {suggesting && <span className="import-ai-badge">Thinking…</span>}
                {proposedCategoryName ? (
                    <NewCategoryBadge
                        name={proposedCategoryName}
                        onRename={setProposedCategoryName}
                        onPickExisting={pickExistingInstead}
                    />
                ) : (
                    <select
                        className="ledger-category-select"
                        value={categoryId ?? ''}
                        onChange={(e) => updateCategory(e.target.value)}
                    >
                        <option value="">Uncategorized</option>
                        {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                )}
                {aiSuggested && !proposedCategoryName && <span className="import-ai-badge">AI guess</span>}
            </div>
            <div className="add-transaction-amount">
                <select
                    className="ledger-category-select"
                    value={amountType}
                    onChange={(e) => setAmountType(e.target.value as typeof EXPENSE | typeof INCOME)}
                >
                    <option value={EXPENSE}>Expense</option>
                    <option value={INCOME}>Income</option>
                </select>
                <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="add-transaction-amount-input"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                />
                <button type="submit" className="add-transaction-submit" disabled={submitting}>
                    {submitting ? 'Adding…' : 'Add'}
                </button>
                <button type="button" className="add-transaction-cancel" onClick={onCancel} disabled={submitting}>
                    Cancel
                </button>
            </div>
            {error && <p className="ledger-status error add-transaction-error">{error}</p>}
        </form>
    );
}

export default AddTransactionForm
```

- [ ] **Step 2: Add styling**

Create `frontend/src/transactions/AddTransactionForm.css`:

```css
.add-transaction-form {
  flex-direction: column;
  align-items: stretch;
  gap: 0.75rem;
}

.add-transaction-fields {
  grid-template-columns: 6.5rem 1fr auto auto;
  align-items: center;
}

.add-transaction-date,
.add-transaction-description,
.add-transaction-amount-input {
  font-family: var(--sans);
  font-size: 0.9rem;
  color: var(--text-on-paper);
  background: var(--paper);
  border: 1px solid var(--rule-on-paper);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
}

.add-transaction-amount {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.add-transaction-amount-input {
  width: 6rem;
}

.add-transaction-submit,
.add-transaction-cancel {
  font-family: var(--sans);
  font-weight: 600;
  font-size: 0.85rem;
  border: none;
  border-radius: 4px;
  padding: 0.5rem 0.9rem;
  cursor: pointer;
}

.add-transaction-submit {
  background: var(--credit-dim);
  color: var(--text-on-ink-strong);
}

.add-transaction-submit:disabled,
.add-transaction-cancel:disabled {
  opacity: 0.5;
  cursor: default;
}

.add-transaction-cancel {
  background: none;
  color: var(--text-on-paper-dim);
  border: 1px solid var(--rule-on-paper);
}

.add-transaction-error {
  padding: 0;
}
```

- [ ] **Step 3: Wire the form into the Transactions page**

Modify `frontend/src/transactions/Transactions.tsx`. Update the imports at the top:

```tsx
import {useEffect, useMemo, useState} from "react";
import type {Transaction} from "../types/transaction.ts";
import type {Category} from "../types/category.ts";
import {transactionApiService} from "../services/TransactionApiService.ts";
import {categoryApiService} from "../services/CategoryApiService.ts";
import {formatMoney} from "../helpers/money.ts";
import {categoryName, monthKey, monthLabel} from "../helpers/ledger.ts";
import SaveAsRuleButton from "../rules/SaveAsRuleButton.tsx";
import AddTransactionForm from "./AddTransactionForm.tsx";
import "../styles/ledger.css"
import './Transactions.css'
```

Add a new piece of state alongside the existing ones (right after `const [editingCategoryFor, setEditingCategoryFor] = useState<number | null>(null);`):

```tsx
    const [showAddForm, setShowAddForm] = useState(false);
```

Add two handler functions near `handleCategoryChange` (right after it):

```tsx
    function handleTransactionCreated(t: Transaction) {
        setTransactions((prev) => [...(prev ?? []), t]);
        setShowAddForm(false);
    }

    function handleCategoryCreated(c: Category) {
        setCategories((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)));
    }
```

Finally, add the button and conditional form right before the existing `<div className="ledger-filters">` in the returned JSX:

```tsx
            <div className="ledger-toolbar">
                <button type="button" className="ledger-add-button" onClick={() => setShowAddForm(true)}>
                    + Add transaction
                </button>
            </div>

            {showAddForm && (
                <AddTransactionForm
                    categories={categories}
                    onCreated={handleTransactionCreated}
                    onCategoryCreated={handleCategoryCreated}
                    onCancel={() => setShowAddForm(false)}
                />
            )}

            <div className="ledger-filters">
```

(Keep everything else in the file — filters, grouping logic, the ledger rows — unchanged.)

- [ ] **Step 4: Add toolbar styling**

Modify `frontend/src/transactions/Transactions.css` — append:

```css
.ledger-toolbar {
  margin-bottom: 1rem;
}

.ledger-add-button {
  font-family: var(--sans);
  font-weight: 600;
  font-size: 0.85rem;
  background: var(--credit-dim);
  color: var(--text-on-ink-strong);
  border: none;
  border-radius: 4px;
  padding: 0.5rem 1rem;
  cursor: pointer;
}

.ledger-add-button:hover {
  opacity: 0.85;
}
```

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification in the running app**

Run: `cd backend && npm run dev` (or the project's existing dev script) and `cd frontend && npm run dev`, then in the browser on `/transactions`:

1. With Ollama running: click "+ Add transaction", type a description that matches an existing transaction's history or a keyword rule, tab out of the field — confirm the category pre-fills with no "AI guess" badge. Type a description with no history/rule match that you expect Ollama to recognize — confirm it pre-fills with the "AI guess" badge (existing category) or a `NewCategoryBadge` (new category name), and that accepting a new-category proposal and submitting creates both the category (visible on `/categories`) and the transaction.
2. With Ollama stopped: repeat the no-match case — confirm the field just blurs with no suggestion (no error shown to the user) and the transaction can still be submitted as Uncategorized.
3. Confirm "Cancel" discards the draft and collapses the form, and that a submitted transaction appears in the ledger immediately without a page reload.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/transactions/AddTransactionForm.tsx frontend/src/transactions/AddTransactionForm.css frontend/src/transactions/Transactions.tsx frontend/src/transactions/Transactions.css
git commit -m "Add manual transaction entry form with Ollama category suggestions"
```

---

## Self-Review Notes

- **Spec coverage:** backend endpoint + signal priority (Task 1), frontend suggest-on-blur + AI/new-category badges reusing existing components + silent-on-failure + category creation on submit + out-of-scope bill picker respected (Task 3), API plumbing (Task 2). All spec sections have a corresponding task/step.
- **Type consistency:** `CategorySuggestion` (Task 2) matches the response shape produced in Task 1 and consumed in Task 3's `handleDescriptionBlur`. `onCreated`/`onCategoryCreated`/`onCancel` prop names match between the component definition (Task 3, Step 1) and the wiring (Task 3, Step 3).
- **No placeholders:** every step has complete, concrete code.
