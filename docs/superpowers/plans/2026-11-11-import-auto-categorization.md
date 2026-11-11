# Import Auto-Categorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When previewing an imported statement, pre-fill each candidate transaction's category with whatever category was most recently assigned to an already-confirmed transaction with the exact same description, so recurring merchants don't need manual re-categorization after every import.

**Architecture:** One new read method on the existing `TransactionService` (exact description match, most-recent-date tiebreak), wired into the existing `previewImport` controller alongside the `isDuplicate` flag it already computes. On the frontend, `Import.tsx` gains the same inline category picker already shipped on `Transactions.tsx`, pre-filled from the backend's suggestion and editable before confirming.

**Tech Stack:** Express 5, `node:sqlite` (`DatabaseSync`), Node's built-in test runner (`node --test`), React 19, Axios.

## Global Constraints

- This branch is built on top of the category-management work (`Category`/`NewCategory` types, `CategoryApiService`, `categoryName` helper, categories table with `color` column already exist — see `docs/superpowers/specs/2026-11-10-category-management-design.md`). Don't recreate any of it.
- Backend files are TypeScript run directly by Node — import local files with an explicit `.ts` extension.
- Every backend test file sets `process.env.DATABASE_FILE = ':memory:'` before the first dynamic `import` of anything that imports `db.ts`, then uses `await import(...)` — copy this pattern exactly.
- Match is exact string equality on `description`, against the `transactions` table only (never other candidates in the same batch), tiebroken by `ORDER BY date DESC, id DESC` (most recent wins). No fuzzy/partial matching.
- There is no frontend test framework in this repo. Frontend verification is a TypeScript build check (`npx tsc -b --noEmit`) plus a manual check in the running app.
- Match existing code style: JSDoc-style `/** ... */` comments above exported backend functions/methods; no such comments in frontend `.tsx`/`.ts` files.
- No new HTTP-level test for `previewImport` itself — there's no fixture PDF in this repo and no existing test exercises that endpoint over HTTP. Coverage for this feature lives at the `TransactionService` unit-test level, matching how `existsSimilar` is covered today.

---

### Task 1: `TransactionService.findRecentCategoryForDescription`

**Files:**
- Modify: `backend/src/services/transactions.service.ts`
- Test: `backend/src/services/transactions.service.test.ts`

**Interfaces:**
- Consumes: `db` (existing), `CategoryService.createCategory` (existing, from category-management) for test setup only.
- Produces: `TransactionService.findRecentCategoryForDescription(description: string): number | null`.

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `backend/src/services/transactions.service.test.ts`:

```ts
test('findRecentCategoryForDescription returns null when nothing matches', () => {
    assert.equal(service.findRecentCategoryForDescription('Nonexistent Merchant'), null);
});

test('findRecentCategoryForDescription ignores uncategorized matches', () => {
    service.createMany([
        {date: '2026-07-01', description: 'Uncategorized Merchant', amount_cents: -1000, category_id: null, bill_id: null},
    ]);
    assert.equal(service.findRecentCategoryForDescription('Uncategorized Merchant'), null);
});

test('findRecentCategoryForDescription returns the category from a matching transaction', async () => {
    const {CategoryService} = await import('./categories.service.ts');
    const categoryService = new CategoryService();
    const category = categoryService.createCategory({name: 'Groceries Test', color: '#6b9478'});

    service.createMany([
        {date: '2026-08-01', description: 'Trader Joes Austin TX', amount_cents: -5000, category_id: category.id, bill_id: null},
    ]);

    assert.equal(service.findRecentCategoryForDescription('Trader Joes Austin TX'), category.id);
});

test('findRecentCategoryForDescription uses the most recently dated match when categories differ', async () => {
    const {CategoryService} = await import('./categories.service.ts');
    const categoryService = new CategoryService();
    const older = categoryService.createCategory({name: 'Older Category Test', color: '#c06c52'});
    const newer = categoryService.createCategory({name: 'Newer Category Test', color: '#c99a3c'});

    service.createMany([
        {date: '2026-01-01', description: 'Recurring Merchant', amount_cents: -1000, category_id: older.id, bill_id: null},
        {date: '2026-06-01', description: 'Recurring Merchant', amount_cents: -1000, category_id: newer.id, bill_id: null},
    ]);

    assert.equal(service.findRecentCategoryForDescription('Recurring Merchant'), newer.id);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test src/services/transactions.service.test.ts`
Expected: FAIL — `findRecentCategoryForDescription` is not a function.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/services/transactions.service.ts`, add this method to `TransactionService` (right after `existsSimilar`):

```ts
    /**
     * Finds the category most recently assigned to a transaction with this
     * exact description. Used to suggest a category for a newly imported
     * transaction that looks like one the user has already categorized.
     *
     * @return The matching category_id, or null if no categorized
     * transaction shares this description.
     */
    findRecentCategoryForDescription(description: string): number | null {
        const row = db.prepare(
            `SELECT category_id FROM transactions
             WHERE description = ? AND category_id IS NOT NULL
             ORDER BY date DESC, id DESC LIMIT 1`
        ).get(description) as {category_id: number} | undefined;
        return row?.category_id ?? null;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test src/services/transactions.service.test.ts`
Expected: PASS (8 tests: 4 existing + 4 new)

Then run the full backend suite:

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/transactions.service.ts backend/src/services/transactions.service.test.ts
git commit -m "Add TransactionService.findRecentCategoryForDescription"
```

---

### Task 2: Wire the suggestion into `previewImport`

**Files:**
- Modify: `backend/src/controllers/transactionsImport.controller.ts`

**Interfaces:**
- Consumes: `TransactionService.findRecentCategoryForDescription` (Task 1).

This has no new automated test, per the Global Constraints note above (no HTTP-level test exists for `previewImport`, and this one-line wiring is trusted the same way the existing `isDuplicate` wiring is). It's verified by Task 4's manual check instead.

- [ ] **Step 1: Wire the suggestion**

In `backend/src/controllers/transactionsImport.controller.ts`, replace the `withDuplicateFlags` mapping in `previewImport`:

```ts
    const withSuggestions = transactions.map((t) => ({
        ...t,
        category_id: transactionService.findRecentCategoryForDescription(t.description),
        isDuplicate: transactionService.existsSimilar(t.date, t.description, t.amount_cents),
    }));

    return res.status(200).json({data: {transactions: withSuggestions}});
```

(This replaces both the `const withDuplicateFlags = ...` block and the `return res.status(200).json({data: {transactions: withDuplicateFlags}});` line below it.)

- [ ] **Step 2: Verify the backend still builds and tests pass**

Run: `cd backend && npm test`
Expected: PASS (same count as Task 1 — this step adds no new tests)

- [ ] **Step 3: Commit**

```bash
git add backend/src/controllers/transactionsImport.controller.ts
git commit -m "Suggest a category on import preview from matching transaction history"
```

---

### Task 3: Import page gets the inline category picker

**Files:**
- Modify: `frontend/src/import/Import.tsx`
- Modify: `frontend/src/import/Import.css`

**Interfaces:**
- Consumes: `categoryApiService` (from category-management), `categoryName` (from `helpers/ledger.ts`, category-management), `Category` type.

- [ ] **Step 1: Update imports and add categories/editing state**

In `frontend/src/import/Import.tsx`, update the top of the file:

```tsx
import {useEffect, useState, type ChangeEvent} from "react";
import {importApiService} from "../services/ImportApiService.ts";
import {categoryApiService} from "../services/CategoryApiService.ts";
import type {ImportCandidate, NewTransaction} from "../types/transaction.ts";
import type {Category} from "../types/category.ts";
import {formatMoney} from "../helpers/money.ts";
import {categoryName} from "../helpers/ledger.ts";
import "../styles/ledger.css"
import './Import.css'

type Candidate = ImportCandidate & {selected: boolean};

function toNewTransaction({selected, isDuplicate, ...t}: Candidate): NewTransaction {
    return t;
}

function Import() {
    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<string | null>(null);
    const [editingCategoryFor, setEditingCategoryFor] = useState<number | null>(null);

    useEffect(() => {
        categoryApiService.getAllCategories().then(setCategories).catch(() => {});
    }, [])
```

(The rest of `handleFileChange`, `toggle`, and `handleConfirm` are unchanged.)

- [ ] **Step 2: Add the category-change handler**

Add this function inside `Import`, right after `toggle`:

```tsx
    function updateCandidateCategory(index: number, value: string) {
        const category_id = value === '' ? null : Number(value);
        setCandidates((prev) => prev.map((c, i) => i === index ? {...c, category_id} : c));
        setEditingCategoryFor(null);
    }
```

- [ ] **Step 3: Move the duplicate flag out of the grid's third column, add the category picker**

Replace:

```tsx
                                <div className="ledger-row__main">
                                    <time className="ledger-date" dateTime={c.date}>{c.date}</time>
                                    <span className="ledger-desc">{c.description}</span>
                                    {c.isDuplicate && (
                                        <span className="ledger-category import-duplicate">Possible duplicate</span>
                                    )}
                                </div>
```

with:

```tsx
                                <div className="ledger-row__main">
                                    <time className="ledger-date" dateTime={c.date}>{c.date}</time>
                                    <span className="ledger-desc">
                                        {c.description}
                                        {c.isDuplicate && (
                                            <span className="import-duplicate-badge">Possible duplicate</span>
                                        )}
                                    </span>
                                    {editingCategoryFor === i ? (
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
                                </div>
```

- [ ] **Step 4: Replace the old duplicate-pill CSS with the new inline badge, add the picker styles**

In `frontend/src/import/Import.css`, replace:

```css
.import-duplicate {
  color: var(--due);
  border-color: var(--due);
}
```

with:

```css
.import-duplicate-badge {
  margin-left: 0.5rem;
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.03em;
  color: var(--due);
}

.ledger-category-button {
  background: none;
  cursor: pointer;
}

.ledger-category-button:hover {
  border-color: var(--text-on-paper);
}

.ledger-category-button:focus-visible {
  outline: 2px solid var(--due);
  outline-offset: 2px;
}

.ledger-category-select {
  font-family: var(--mono);
  font-size: 0.72rem;
  letter-spacing: 0.03em;
  color: var(--text-on-paper);
  background: var(--paper);
  border: 1px solid var(--rule-on-paper);
  border-radius: 999px;
  padding: 0.15rem 0.4rem;
}

.ledger-category-select:focus-visible {
  outline: 2px solid var(--due);
  outline-offset: 2px;
}
```

- [ ] **Step 5: Verify it compiles**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 6: Manually verify**

Run: `cd backend && npm run dev` and `cd frontend && npm run dev` (or reuse whatever local dev setup you already have for this project), log in, go to Transactions, categorize a transaction with a distinctive description (e.g. "Test Merchant Co"). Then manually insert a second transaction with that exact same description via the API or re-import a statement containing it (if you don't have a real statement handy, insert directly: `POST /api/v1/transactions` with that description and `category_id: null`), and confirm on the Import preview page that it shows up with the category already suggested, and that clicking the pill still lets you change it before confirming. Also confirm a transaction flagged as a possible duplicate still shows the "Possible duplicate" badge next to its description, not in place of the category control.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/import/Import.tsx frontend/src/import/Import.css
git commit -m "Add category suggestion picker to the Import preview page"
```
