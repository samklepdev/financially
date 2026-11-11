# Keyword-Based Category Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user maintain a table of keyword/merchant patterns → category, so that an imported transaction with no prior categorized history for its exact description can still get a category suggested automatically, with zero per-transaction manual work.

**Architecture:** A new `category_rules` table and a `CategoryRuleService` vertical slice, mirroring the existing `categories` slice exactly (service/controller/router/validation). `CategoryRuleService.findCategoryForDescription` does a case-insensitive substring match, longest-pattern-wins. `previewImport` tries the already-shipped exact-history match first, and only falls back to this rule match when that returns `null`. A new `/rules` page manages the rules, reusing the ledger-row list style already established by the Categories page.

**Tech Stack:** Express 5, `node:sqlite` (`DatabaseSync`), Node's built-in test runner (`node --test`), React 19, Axios.

## Global Constraints

- This branch builds on top of the already-merged category-management and import-auto-categorization work (`Category` type, `CategoryApiService`, `categories` table, `TransactionService.findRecentCategoryForDescription`, the import preview category picker). Don't recreate any of it.
- Backend files are TypeScript run directly by Node — import local files with an explicit `.ts` extension.
- Every backend test file sets `process.env.DATABASE_FILE = ':memory:'` before the first dynamic `import` of anything that imports `db.ts`, then uses `await import(...)` — copy this pattern exactly.
- The login rate limiter allows 5 attempts per IP per 15-minute window, shared across the whole test process — log in **once** at the top of a route test file (via a throwaway bootstrap `listen()`/`close()`) and reuse the cookie in every test in that file, exactly like `categories.test.ts` already does. Do not call the login endpoint once per test.
- Pattern matching is case-insensitive substring only (SQLite's `instr(lower(x), lower(y))`), longest-pattern-wins on ties among matches. No regex, no manual priority field.
- There is no frontend test framework in this repo. Frontend verification is a TypeScript build check (`npx tsc -b --noEmit`) plus a manual check in the running app.
- Match existing code style: JSDoc-style `/** ... */` comments above exported backend functions/methods; no such comments in frontend `.tsx`/`.ts` files.
- No new HTTP-level test for `previewImport`'s fallback wiring itself — same reasoning as the already-merged history-match wiring (no fixture PDF exists; see `docs/superpowers/specs/2026-11-11-import-auto-categorization-design.md`). Verified manually instead.

---

### Task 1: `category_rules` table

**Files:**
- Modify: `backend/src/config/db.ts`
- Test: `backend/src/config/db.test.ts`

**Interfaces:**
- Produces: a `category_rules(id, pattern, category_id)` table, `category_id` FK to `categories(id) ON DELETE CASCADE`, readable/writable through the existing `db` singleton.

- [ ] **Step 1: Write the failing test**

Add to the bottom of `backend/src/config/db.test.ts`:

```ts
test('category_rules table enforces a category_id foreign key and cascades on delete', () => {
    db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)').run('Rule Test Category', '#6b9478');
    const category = db.prepare('SELECT * FROM categories WHERE name = ?').get('Rule Test Category') as {id: number};

    db.prepare('INSERT INTO category_rules (pattern, category_id) VALUES (?, ?)').run('walmart', category.id);
    const rule = db.prepare('SELECT * FROM category_rules WHERE pattern = ?').get('walmart') as
        {id: number, category_id: number} | undefined;
    assert.ok(rule);
    assert.equal(rule.category_id, category.id);

    db.prepare('DELETE FROM categories WHERE id = ?').run(category.id);
    const afterDelete = db.prepare('SELECT * FROM category_rules WHERE pattern = ?').get('walmart');
    assert.equal(afterDelete, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/config/db.test.ts`
Expected: FAIL — `no such table: category_rules`.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/config/db.ts`, add the new table inside the existing `db.exec(...)` block, right after the `sessions` table (before the closing backtick):

```ts
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS category_rules(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL,
        category_id INTEGER NOT NULL,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    ) STRICT;
`)
```

(Only the table is new — leave the `categoryColumns`/`ALTER TABLE` block below it untouched.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/config/db.test.ts`
Expected: PASS (3 tests: 2 existing + 1 new)

- [ ] **Step 5: Commit**

```bash
git add backend/src/config/db.ts backend/src/config/db.test.ts
git commit -m "Add category_rules table"
```

---

### Task 2: CategoryRule type and validation

**Files:**
- Create: `backend/src/types/categoryRule.ts`
- Create: `backend/src/types/categoryRuleApiResult.ts`
- Create: `backend/src/helpers/categoryRuleValidation.ts`
- Test: `backend/src/helpers/categoryRuleValidation.test.ts`

**Interfaces:**
- Produces: `CategoryRule = {id: number, pattern: string, category_id: number}`, `NewCategoryRule = Omit<CategoryRule, 'id'>`, and `validateCategoryRule(body: unknown): CategoryRuleApiResult` where `CategoryRuleApiResult = {ok: true, value: NewCategoryRule} | {ok: false, error: string}`.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/helpers/categoryRuleValidation.test.ts`:

```ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCategoryRule} from './categoryRuleValidation.ts';

test('rejects a non-object body', () => {
    const result = validateCategoryRule('nope');
    assert.equal(result.ok, false);
});

test('rejects a missing pattern', () => {
    const result = validateCategoryRule({category_id: 1});
    assert.equal(result.ok, false);
});

test('rejects an empty pattern', () => {
    const result = validateCategoryRule({pattern: '   ', category_id: 1});
    assert.equal(result.ok, false);
});

test('rejects a missing category_id', () => {
    const result = validateCategoryRule({pattern: 'walmart'});
    assert.equal(result.ok, false);
});

test('rejects a non-integer category_id', () => {
    const result = validateCategoryRule({pattern: 'walmart', category_id: 'one'});
    assert.equal(result.ok, false);
});

test('accepts a valid rule and returns the normalized value', () => {
    const result = validateCategoryRule({pattern: 'walmart', category_id: 1});
    assert.deepEqual(result, {ok: true, value: {pattern: 'walmart', category_id: 1}});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test src/helpers/categoryRuleValidation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/types/categoryRule.ts`:

```ts
export type CategoryRule = {
    id: number;
    pattern: string;
    category_id: number;
}

export type NewCategoryRule = Omit<CategoryRule, 'id'>;
```

Create `backend/src/types/categoryRuleApiResult.ts`:

```ts
import type {NewCategoryRule} from "./categoryRule.ts";

export type CategoryRuleApiResult =
    | { ok: true, value: NewCategoryRule }
    | { ok: false, error: string };
```

Create `backend/src/helpers/categoryRuleValidation.ts`:

```ts
import type {CategoryRuleApiResult} from "../types/categoryRuleApiResult.ts";

/**
 * @desc Validate a category rule object
 * @desc Returns a CategoryRuleApiResult with either the validated rule or an error message
 * @param body
 */
export function validateCategoryRule(body: unknown): CategoryRuleApiResult {
    // Return false if it isn't an object
    if (typeof body !== 'object' || body === null) {
        return {ok: false, error: 'Body must be a JSON Object'}
    }

    const b = body as Record<string, unknown>;

    // Return false if pattern is not a string or is missing
    if (typeof b.pattern !== 'string' || b.pattern.trim() === '') {
        return {ok: false, error: 'pattern is required'}
    }

    // Return false if category_id is not an integer
    if (!Number.isInteger(b.category_id)) {
        return {ok: false, error: 'category_id must be an integer'}
    }

    return {
        ok: true,
        value: {
            pattern: b.pattern,
            category_id: b.category_id as number,
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test src/helpers/categoryRuleValidation.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/types/categoryRule.ts backend/src/types/categoryRuleApiResult.ts backend/src/helpers/categoryRuleValidation.ts backend/src/helpers/categoryRuleValidation.test.ts
git commit -m "Add CategoryRule type and validateCategoryRule helper"
```

---

### Task 3: CategoryRuleService

**Files:**
- Create: `backend/src/services/categoryRules.service.ts`
- Test: `backend/src/services/categoryRules.service.test.ts`

**Interfaces:**
- Consumes: `db` (Task 1), `CategoryRule`/`NewCategoryRule` (Task 2), `CategoryService` (existing, for test setup only).
- Produces: `CategoryRuleService` with `getAllCategoryRules(): CategoryRule[]`, `getCategoryRuleById(id): CategoryRule | undefined`, `createCategoryRule(r: NewCategoryRule): CategoryRule`, `updateCategoryRule(id, r: NewCategoryRule): CategoryRule | undefined`, `deleteCategoryRule(id): {changes: number}`, `findCategoryForDescription(description: string): number | null`.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/categoryRules.service.test.ts`:

```ts
import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_FILE = ':memory:';
const {CategoryRuleService} = await import('./categoryRules.service.ts');
const {CategoryService} = await import('./categories.service.ts');

const service = new CategoryRuleService();
const categoryService = new CategoryService();

test('createCategoryRule inserts and returns the rule with an id', () => {
    const category = categoryService.createCategory({name: 'Groceries Rule Test', color: '#6b9478'});
    const created = service.createCategoryRule({pattern: 'walmart', category_id: category.id});
    assert.ok(created.id);
    assert.equal(created.pattern, 'walmart');
    assert.equal(created.category_id, category.id);
});

test('getCategoryRuleById returns undefined for a missing id', () => {
    assert.equal(service.getCategoryRuleById(999999), undefined);
});

test('updateCategoryRule changes pattern and category_id', () => {
    const category = categoryService.createCategory({name: 'Dining Rule Test', color: '#c06c52'});
    const otherCategory = categoryService.createCategory({name: 'Subscriptions Rule Test', color: '#c99a3c'});
    const created = service.createCategoryRule({pattern: 'uber eats', category_id: category.id});

    const updated = service.updateCategoryRule(created.id, {pattern: 'netflix', category_id: otherCategory.id});
    assert.equal(updated?.pattern, 'netflix');
    assert.equal(updated?.category_id, otherCategory.id);
});

test('updateCategoryRule returns undefined for a missing id', () => {
    const category = categoryService.createCategory({name: 'Missing Update Rule Test', color: '#000000'});
    const updated = service.updateCategoryRule(999999, {pattern: 'nope', category_id: category.id});
    assert.equal(updated, undefined);
});

test('deleteCategoryRule removes the row and reports changes', () => {
    const category = categoryService.createCategory({name: 'Temp Rule Test', color: '#000000'});
    const created = service.createCategoryRule({pattern: 'temp merchant', category_id: category.id});
    const {changes} = service.deleteCategoryRule(created.id);
    assert.equal(changes, 1);
    assert.equal(service.getCategoryRuleById(created.id), undefined);
});

test('findCategoryForDescription returns null when nothing matches', () => {
    assert.equal(service.findCategoryForDescription('Totally Unrelated Merchant XYZ'), null);
});

test('findCategoryForDescription matches case-insensitively as a substring', () => {
    const category = categoryService.createCategory({name: 'Groceries Substring Test', color: '#6b9478'});
    service.createCategoryRule({pattern: 'TraderJoesTest', category_id: category.id});

    assert.equal(service.findCategoryForDescription('tradeRjoesTest Austin TX'), category.id);
});

test('findCategoryForDescription returns the longest matching pattern when rules overlap', () => {
    const generic = categoryService.createCategory({name: 'Generic Rule Test', color: '#c06c52'});
    const specific = categoryService.createCategory({name: 'Specific Rule Test', color: '#c99a3c'});
    service.createCategoryRule({pattern: 'cash app', category_id: generic.id});
    service.createCategoryRule({pattern: 'cash app pay walmart', category_id: specific.id});

    assert.equal(
        service.findCategoryForDescription('Cash App Pay Walmart Houston TX'),
        specific.id
    );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test src/services/categoryRules.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/services/categoryRules.service.ts`:

```ts
import {db} from "../config/db.ts";
import type {CategoryRule, NewCategoryRule} from "../types/categoryRule.ts";

export class CategoryRuleService {
    /**
     * Retrieves all category rules from the database, ordered alphabetically by pattern.
     *
     * @return {CategoryRule[]} An array of category rules sorted A-Z by pattern.
     */
    getAllCategoryRules() {
        return db.prepare('SELECT * FROM category_rules ORDER BY pattern').all() as CategoryRule[];
    }

    /**
     * Retrieves a category rule by its unique identifier.
     *
     * @param id The unique identifier of the category rule to retrieve.
     * @return The matching category rule, or undefined if no rule is found.
     */
    getCategoryRuleById(id: number) {
        return db.prepare('SELECT * FROM category_rules WHERE id = ?').get(id) as CategoryRule | undefined;
    }

    /**
     * Creates a new category rule record in the database and returns the inserted rule.
     *
     * @param rule The rule data to insert, including pattern and category_id.
     * @return The newly created category rule record.
     */
    createCategoryRule(rule: NewCategoryRule) {
        return db.prepare('INSERT INTO category_rules (pattern, category_id) VALUES (?, ?) RETURNING *')
            .get(rule.pattern, rule.category_id) as CategoryRule;
    }

    /**
     * Updates an existing category rule record with the provided rule data.
     *
     * @param id The unique identifier of the category rule to update.
     * @param rule The new rule data to apply.
     * @return The updated category rule record, or undefined if no rule was updated.
     */
    updateCategoryRule(id: number, rule: NewCategoryRule) {
        return db.prepare('UPDATE category_rules SET pattern = ?, category_id = ? WHERE id = ? RETURNING *')
            .get(rule.pattern, rule.category_id, id) as CategoryRule | undefined;
    }

    /**
     * Deletes a category rule with the specified identifier from the database.
     *
     * @param id The unique identifier of the category rule to delete.
     * @return The result of the delete operation, including the number of affected rows.
     */
    deleteCategoryRule(id: number) {
        return db.prepare('DELETE FROM category_rules WHERE id = ?').run(id);
    }

    /**
     * Finds the category whose rule's pattern is the longest case-insensitive
     * substring match of the given description. Used as a fallback category
     * suggestion for import candidates with no categorized history match.
     *
     * @return The matching category_id, or null if no rule's pattern matches.
     */
    findCategoryForDescription(description: string): number | null {
        const row = db.prepare(
            `SELECT category_id FROM category_rules
             WHERE instr(lower(?), lower(pattern)) > 0
             ORDER BY length(pattern) DESC LIMIT 1`
        ).get(description) as {category_id: number} | undefined;
        return row?.category_id ?? null;
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test src/services/categoryRules.service.test.ts`
Expected: PASS (8 tests)

Then run the full backend suite:

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/categoryRules.service.ts backend/src/services/categoryRules.service.test.ts
git commit -m "Add CategoryRuleService"
```

---

### Task 4: CategoryRule controller, router, and wiring

**Files:**
- Create: `backend/src/controllers/categoryRules.controller.ts`
- Create: `backend/src/routes/categoryRules.router.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/routes/categoryRules.test.ts`

**Interfaces:**
- Consumes: `CategoryRuleService` (Task 3), `validateCategoryRule` (Task 2), `requireAuth` (existing).
- Produces: `categoryRulesRouter` mounted at `/api/v1/category-rules`, behind `requireAuth`.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/routes/categoryRules.test.ts`:

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

const bootstrap = await listen(app);
const cookie = await loginCookie(bootstrap.url);
await bootstrap.close();

async function createCategory(url: string, name: string): Promise<number> {
    const res = await fetch(`${url}/api/v1/categories`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Cookie: cookie},
        body: JSON.stringify({name, color: '#6b9478'}),
    });
    const {data} = await res.json();
    return data.id;
}

test('/api/v1/category-rules requires authentication', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/category-rules`);
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('creates a category rule and returns it with an id', async () => {
    const {url, close} = await listen(app);
    try {
        const categoryId = await createCategory(url, 'Groceries Route Test');
        const res = await fetch(`${url}/api/v1/category-rules`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({pattern: 'walmart', category_id: categoryId}),
        });
        assert.equal(res.status, 201);
        const body = await res.json();
        assert.ok(body.data.id);
        assert.equal(body.data.pattern, 'walmart');
    } finally {
        await close();
    }
});

test('rejects a rule referencing a nonexistent category', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/category-rules`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({pattern: 'walmart', category_id: 999999}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('updates a category rule', async () => {
    const {url, close} = await listen(app);
    try {
        const categoryId = await createCategory(url, 'Dining Route Test');
        const createRes = await fetch(`${url}/api/v1/category-rules`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({pattern: 'uber eats', category_id: categoryId}),
        });
        const {data: created} = await createRes.json();

        const updateRes = await fetch(`${url}/api/v1/category-rules/${created.id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({pattern: 'doordash', category_id: categoryId}),
        });
        assert.equal(updateRes.status, 200);
        const {data: updated} = await updateRes.json();
        assert.equal(updated.pattern, 'doordash');
    } finally {
        await close();
    }
});

test('deleting a category rule 404s when it does not exist', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/category-rules/999999`, {
            method: 'DELETE',
            headers: {Cookie: cookie},
        });
        assert.equal(res.status, 404);
    } finally {
        await close();
    }
});

test('deletes a category rule', async () => {
    const {url, close} = await listen(app);
    try {
        const categoryId = await createCategory(url, 'Temp Route Test');
        const createRes = await fetch(`${url}/api/v1/category-rules`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({pattern: 'temp pattern', category_id: categoryId}),
        });
        const {data: created} = await createRes.json();

        const deleteRes = await fetch(`${url}/api/v1/category-rules/${created.id}`, {
            method: 'DELETE',
            headers: {Cookie: cookie},
        });
        assert.equal(deleteRes.status, 204);
    } finally {
        await close();
    }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test src/routes/categoryRules.test.ts`
Expected: FAIL — every request 404s (no such route yet).

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/controllers/categoryRules.controller.ts`:

```ts
import type { Request, Response } from 'express';
import {validateCategoryRule} from "../helpers/categoryRuleValidation.ts";
import {CategoryRuleService} from "../services/categoryRules.service.ts";

const categoryRuleService = new CategoryRuleService();

/**
 * Retrieves all category rules from the database, ordered alphabetically by
 * pattern, and sends them in a JSON response.
 *
 * @param _req - The incoming request object. This parameter is not used.
 * @param res - The response object used to send the rule data.
 * @return The HTTP response containing the list of category rules.
 */
export function getAllCategoryRules(_req: Request, res: Response) {
    const rules = categoryRuleService.getAllCategoryRules();
    return res.status(200).json({data: rules});
}

/**
 * Retrieves a category rule by its numeric identifier from the request parameters and sends the result as a JSON response.
 *
 * @param req Express request containing the rule id route parameter.
 * @param res Express response used to send validation errors, not found errors, or the rule data.
 * @return The HTTP response containing either an error message or the requested rule data.
 */
export function getCategoryRuleById(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const rule = categoryRuleService.getCategoryRuleById(id);
    if (!rule) {
        return res.status(404).json({error: 'Category rule not found'});
    }

    return res.status(200).json({data: rule});
}

/**
 * Creates a new category rule from the request body after validating the submitted data.
 * Responds with a 400 status and validation error when the request body is invalid.
 * Responds with a 201 status and the created rule when insertion succeeds.
 * Responds with a 400 status when the referenced category does not exist.
 *
 * @param req Express request containing the rule data in the request body.
 * @param res Express response used to send the creation result or error response.
 * @return The Express response containing the created rule or an error response.
 */
export function createCategoryRule(req: Request, res: Response) {
    const result = validateCategoryRule(req.body);
    if (!result.ok) {
        return res.status(400).json({error: result.error});
    }

    try {
        const created = categoryRuleService.createCategoryRule(result.value);
        return res.status(201).json({data: created});
    } catch (err) {
        if (err instanceof Error && err.message.includes('FOREIGN KEY')) {
            return res.status(400).json({error: 'Category does not exist'});
        }
        throw err;
    }
}

/**
 * Updates an existing category rule by its request parameter id using the validated request body.
 *
 * @param req Express request containing the rule id in the route parameters and updated rule data in the body.
 * @param res Express response used to return the updated rule or an error response.
 * @return A JSON response with the updated rule, a validation error, a not found error, or a foreign key error.
 */
export function updateCategoryRule(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const result = validateCategoryRule(req.body);
    if (!result.ok) {
        return res.status(400).json({error: result.error});
    }

    try {
        const updated = categoryRuleService.updateCategoryRule(id, result.value);
        if (!updated) {
            return res.status(404).json({error: 'Category rule not found'});
        }
        return res.status(200).json({data: updated});
    } catch (err) {
        if (err instanceof Error && err.message.includes('FOREIGN KEY')) {
            return res.status(400).json({error: 'Category does not exist'});
        }
        throw err;
    }
}

/**
 * Deletes a category rule identified by the request route parameter.
 *
 * @param req Express request containing the rule id in the route parameters.
 * @param res Express response used to return the deletion result.
 * @return A response with status 204 when deleted, 400 when the id is invalid, or 404 when no rule is found.
 */
export function deleteCategoryRule(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const {changes} = categoryRuleService.deleteCategoryRule(id);
    if (changes === 0) {
        return res.status(404).json({error: 'Category rule not found'});
    }

    return res.status(204).end();
}
```

Create `backend/src/routes/categoryRules.router.ts`:

```ts
import express from "express";
import {
    createCategoryRule, deleteCategoryRule, getAllCategoryRules, getCategoryRuleById, updateCategoryRule
} from "../controllers/categoryRules.controller.ts";

export const categoryRulesRouter = express.Router()

categoryRulesRouter.get('/', getAllCategoryRules);
categoryRulesRouter.post('/', createCategoryRule);
categoryRulesRouter.get('/:id', getCategoryRuleById);
categoryRulesRouter.put('/:id', updateCategoryRule);
categoryRulesRouter.delete('/:id', deleteCategoryRule);
```

Modify `backend/src/app.ts` — add the import and mount the router next to `categoriesRouter`:

```ts
import express, {type Request, type Response} from 'express';
import {fileURLToPath} from 'node:url';
import {transactionsRouter} from './routes/transactions.router.ts'
import {categoriesRouter} from './routes/categories.router.ts'
import {categoryRulesRouter} from './routes/categoryRules.router.ts'
import {authRouter} from './routes/auth.router.ts'
import {requireAuth} from './middleware/requireAuth.ts'

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Routes
app.use('/api/v1/auth', authRouter)
app.use('/api/v1/transactions', requireAuth, transactionsRouter)
app.use('/api/v1/categories', requireAuth, categoriesRouter)
app.use('/api/v1/category-rules', requireAuth, categoryRulesRouter)
```

(Leave the rest of `app.ts` unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test src/routes/categoryRules.test.ts`
Expected: PASS (6 tests)

Then run the full backend suite:

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/categoryRules.controller.ts backend/src/routes/categoryRules.router.ts backend/src/routes/categoryRules.test.ts backend/src/app.ts
git commit -m "Add categoryRules controller, router, and mount under /api/v1/category-rules"
```

---

### Task 5: Wire the rule fallback into `previewImport`

**Files:**
- Modify: `backend/src/controllers/transactionsImport.controller.ts`

**Interfaces:**
- Consumes: `CategoryRuleService.findCategoryForDescription` (Task 3), `TransactionService.findRecentCategoryForDescription` (already merged).

No new automated test, per the Global Constraints note (no HTTP-level test exists for `previewImport`, and this wiring is trusted the same way the existing history-match wiring is). Verified by Task 7's manual check instead.

- [ ] **Step 1: Wire the fallback**

In `backend/src/controllers/transactionsImport.controller.ts`, add the import and instantiate the service:

```ts
import type {Request, Response} from 'express';
import {parseCashAppStatementPdf} from '../services/cashAppStatementParser.ts';
import {validateTransaction} from '../helpers/transactionValidation.ts';
import {TransactionService} from '../services/transactions.service.ts';
import {CategoryRuleService} from '../services/categoryRules.service.ts';
import type {NewTransaction} from '../types/transaction.ts';

const transactionService = new TransactionService();
const categoryRuleService = new CategoryRuleService();
```

Replace the `withSuggestions` mapping:

```ts
    const withSuggestions = transactions.map((t) => ({
        ...t,
        category_id: transactionService.findRecentCategoryForDescription(t.description)
            ?? categoryRuleService.findCategoryForDescription(t.description),
        isDuplicate: transactionService.existsSimilar(t.date, t.description, t.amount_cents),
    }));
```

- [ ] **Step 2: Verify the backend still builds and tests pass**

Run: `cd backend && npm test`
Expected: PASS (same count as Task 4 — this step adds no new tests)

- [ ] **Step 3: Commit**

```bash
git add backend/src/controllers/transactionsImport.controller.ts
git commit -m "Fall back to keyword category rules when import history has no match"
```

---

### Task 6: Frontend CategoryRule type and CategoryRuleApiService

**Files:**
- Create: `frontend/src/types/categoryRule.ts`
- Create: `frontend/src/services/CategoryRuleApiService.ts`

**Interfaces:**
- Consumes: `BaseApiService` (existing).
- Produces: `CategoryRule`, `NewCategoryRule` types, singleton `categoryRuleApiService` with `getAllCategoryRules`, `createCategoryRule`, `updateCategoryRule`, `deleteCategoryRule`.

- [ ] **Step 1: Create the type**

Create `frontend/src/types/categoryRule.ts`:

```ts
export type CategoryRule = {
    id: number;
    pattern: string;
    category_id: number;
}

export type NewCategoryRule = Omit<CategoryRule, 'id'>;
```

- [ ] **Step 2: Create the API service**

Create `frontend/src/services/CategoryRuleApiService.ts`:

```ts
import {BaseApiService} from "./BaseApiService.ts";
import type {CategoryRule, NewCategoryRule} from "../types/categoryRule.ts";

export class CategoryRuleApiService extends BaseApiService {

    constructor() {
        super('/category-rules');
    }

    getAllCategoryRules(): Promise<CategoryRule[]> {
        return this.getAll<CategoryRule[]>();
    }

    createCategoryRule(body: NewCategoryRule): Promise<CategoryRule> {
        return this.create<CategoryRule>(body);
    }

    updateCategoryRule(id: number, body: NewCategoryRule): Promise<CategoryRule> {
        return this.update<CategoryRule>(id, body);
    }

    deleteCategoryRule(id: number): Promise<void> {
        return this.delete(id);
    }
}

export const categoryRuleApiService = new CategoryRuleApiService();
```

- [ ] **Step 3: Verify it compiles**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/categoryRule.ts frontend/src/services/CategoryRuleApiService.ts
git commit -m "Add frontend CategoryRule type and CategoryRuleApiService"
```

---

### Task 7: Rules page, route, and nav link

**Files:**
- Create: `frontend/src/rules/Rules.tsx`
- Create: `frontend/src/rules/Rules.css`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/Layout.tsx`

**Interfaces:**
- Consumes: `categoryRuleApiService`, `CategoryRule`/`NewCategoryRule` (Task 6), `categoryApiService`, `Category` (existing).

- [ ] **Step 1: Create the page component**

Create `frontend/src/rules/Rules.tsx`:

```tsx
import {useEffect, useState} from "react";
import {categoryApiService} from "../services/CategoryApiService.ts";
import {categoryRuleApiService} from "../services/CategoryRuleApiService.ts";
import type {Category} from "../types/category.ts";
import type {CategoryRule} from "../types/categoryRule.ts";
import "../styles/ledger.css"
import './Rules.css'

function Rules() {
    const [rules, setRules] = useState<CategoryRule[]>();
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const [newPattern, setNewPattern] = useState('');
    const [newCategoryId, setNewCategoryId] = useState('');

    useEffect(() => {
        Promise.all([
            categoryRuleApiService.getAllCategoryRules(),
            categoryApiService.getAllCategories(),
        ]).then(([r, c]) => {
            setRules(r);
            setCategories(c);
            if (c.length > 0) {
                setNewCategoryId(String(c[0].id));
            }
        }).catch((err) => {
            setError(err.message);
        }).finally(() => {
            setLoading(false);
        });
    }, []);

    async function handleAdd() {
        if (newPattern.trim() === '' || newCategoryId === '') {
            return;
        }

        setError(null);
        try {
            const created = await categoryRuleApiService.createCategoryRule({
                pattern: newPattern.trim(),
                category_id: Number(newCategoryId),
            });
            setRules((prev) => [...(prev ?? []), created]);
            setNewPattern('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not create this rule');
        }
    }

    async function handleCategoryChange(rule: CategoryRule, value: string) {
        setError(null);
        try {
            const updated = await categoryRuleApiService.updateCategoryRule(rule.id, {
                pattern: rule.pattern,
                category_id: Number(value),
            });
            setRules((prev) => (prev ?? []).map((r) => r.id === rule.id ? updated : r));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not update this rule');
        }
    }

    async function handleDelete(id: number) {
        setError(null);
        try {
            await categoryRuleApiService.deleteCategoryRule(id);
            setRules((prev) => (prev ?? []).filter((r) => r.id !== id));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete this rule');
        }
    }

    return (
        <>
            <div className="rule-add">
                <input
                    type="text"
                    placeholder="Pattern (e.g. walmart)"
                    value={newPattern}
                    onChange={(e) => setNewPattern(e.target.value)}
                />
                <select value={newCategoryId} onChange={(e) => setNewCategoryId(e.target.value)}>
                    {categories.length === 0 && <option value="">No categories yet</option>}
                    {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={handleAdd}
                    disabled={newPattern.trim() === '' || newCategoryId === '' || categories.length === 0}
                >
                    Add rule
                </button>
            </div>

            {loading && <p className="ledger-status">Loading rules…</p>}
            {error && <p className="ledger-status error">{error}</p>}
            {!loading && !error && rules?.length === 0 && (
                <p className="ledger-status">No rules yet.</p>
            )}

            {!loading && !error && (rules ?? []).map((rule) => (
                <article className="ledger-row rule-row" key={rule.id}>
                    <span className="rule-pattern">{rule.pattern}</span>
                    <select
                        className="rule-category-select"
                        value={rule.category_id}
                        onChange={(e) => handleCategoryChange(rule, e.target.value)}
                    >
                        {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                    <button type="button" onClick={() => handleDelete(rule.id)}>Delete</button>
                </article>
            ))}
        </>
    )
}

export default Rules
```

- [ ] **Step 2: Create the page styles**

Create `frontend/src/rules/Rules.css`:

```css
.rule-add {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.rule-add input[type="text"] {
  font-family: var(--sans);
  font-size: 0.9rem;
  color: var(--text-on-ink-strong);
  background: var(--ink-raised);
  border: 1px solid var(--rule-on-ink);
  border-radius: 4px;
  padding: 0.5rem 0.7rem;
  flex: 1;
}

.rule-add select {
  font-family: var(--sans);
  font-size: 0.9rem;
  color: var(--text-on-ink-strong);
  background: var(--ink-raised);
  border: 1px solid var(--rule-on-ink);
  border-radius: 4px;
  padding: 0.5rem 0.7rem;
}

.rule-add input[type="text"]:focus-visible,
.rule-add select:focus-visible,
.rule-add button:focus-visible {
  outline: 2px solid var(--due);
  outline-offset: 2px;
}

.rule-add button {
  font-family: var(--sans);
  font-size: 0.85rem;
  color: var(--text-on-ink-strong);
  background: none;
  border: 1px solid var(--rule-on-ink);
  border-radius: 4px;
  padding: 0.45rem 0.8rem;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.rule-add button:hover {
  border-color: var(--text-on-ink);
}

.rule-add button:disabled {
  opacity: 0.5;
  cursor: default;
}

.rule-row {
  gap: 0.85rem;
}

.rule-pattern {
  font-family: var(--mono);
  font-size: 0.85rem;
  flex: 1;
}

.rule-category-select {
  font-family: var(--sans);
  font-size: 0.85rem;
  color: var(--text-on-paper);
  background: var(--paper-dim);
  border: 1px solid var(--rule-on-paper);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
}

.rule-category-select:focus-visible {
  outline: 2px solid var(--due);
  outline-offset: 2px;
}

.rule-row button {
  font-family: var(--sans);
  font-size: 0.85rem;
  color: var(--text-on-paper);
  background: none;
  border: 1px solid var(--rule-on-paper);
  border-radius: 4px;
  padding: 0.45rem 0.8rem;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.rule-row button:hover {
  border-color: var(--text-on-paper);
}

.rule-row button:focus-visible {
  outline: 2px solid var(--due);
  outline-offset: 2px;
}

@media (max-width: 640px) {
  .rule-add {
    flex-wrap: wrap;
  }
}
```

- [ ] **Step 3: Wire the route**

In `frontend/src/main.tsx`, add the import and the route:

```tsx
import Categories from './categories/Categories.tsx'
import Rules from './rules/Rules.tsx'
```

```tsx
<Route path="/categories" element={<Categories/>}/>
<Route path="/rules" element={<Rules/>}/>
```

- [ ] **Step 4: Add the nav link**

In `frontend/src/Layout.tsx`, add a link in `tape-nav`:

```tsx
<NavLink to="/categories" className={navClass}>Categories</NavLink>
<NavLink to="/rules" className={navClass}>Rules</NavLink>
```

- [ ] **Step 5: Verify it compiles and works**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors.

Run the app (`cd backend && npm run dev`, `cd frontend && npm run dev`, or reuse your existing local dev setup), log in, click "Rules" in the nav. Create a category first on the Categories page if you don't have one, then add a rule (e.g. pattern `walmart` → that category), confirm it appears, change its category via the dropdown, then delete it.

- [ ] **Step 6: End-to-end manual verification**

With at least one rule in place (e.g. pattern `walmart` → "Groceries"), go to Import and upload a statement containing a transaction whose description contains that pattern but which you've never manually categorized before (no exact-description history match). Confirm the category picker pre-fills "Groceries" for that row. If you don't have a real statement handy with a matching description, insert a transaction manually via `POST /api/v1/transactions` with a matching description and no category, then re-check that the *next* transaction with that same exact description still gets the manually-assigned category preferentially (history still wins over the rule) — or, to test the rule path specifically, use a description that matches a rule's pattern but doesn't exactly match any existing transaction's description.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/rules frontend/src/main.tsx frontend/src/Layout.tsx
git commit -m "Add Rules management page"
```
