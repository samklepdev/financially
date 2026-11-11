# Category Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make categories a first-class, manageable resource — backend CRUD plus a frontend page and an inline picker on the Transactions list — so the rest of the app can show real category names and colors instead of the current `Cat #N` placeholder.

**Architecture:** Mirror the existing `transactions` vertical slice exactly: a `CategoryService` (raw SQL over the existing `node:sqlite` `db`), a validation helper returning the `{ok, value|error}` shape, a controller/router pair mounted under `requireAuth`, and on the frontend a typed `CategoryApiService` plus a new `/categories` page. The one schema change is an `ALTER TABLE` to add `categories.color`, guarded so it only runs once against an existing database file.

**Tech Stack:** Express 5, `node:sqlite` (`DatabaseSync`), Node's built-in test runner (`node --test`), React 19, `react-router-dom` 7, Axios.

## Global Constraints

- Backend files are TypeScript run directly by Node (`node --watch src/app.ts`) — import other local files with an explicit `.ts` extension, exactly as every existing backend file does (e.g. `import {db} from "../config/db.ts"`).
- Every backend test file sets `process.env.DATABASE_FILE = ':memory:'` **before** the first dynamic `import` of anything that imports `db.ts`, then uses a top-level `await import(...)` to get the module — copy this pattern exactly, don't use a static `import` at the top of a test file.
- Controllers return the same envelope shape as the existing transactions controller: success as `{data: ...}`, errors as `{error: "..."}`; status codes 200/201/204/400/404.
- All new routes under `/categories` are mounted behind `requireAuth`, same as `/transactions`.
- Frontend API services extend `BaseApiService` and only ever call `this.getAll/getById/create/update/delete` — never touch `axios` directly.
- There is no frontend test framework configured in this repo (`frontend/package.json` has no test script). Frontend task "tests" are a TypeScript build check (`npx tsc -b --noEmit`) plus a manual check in the running app — don't invent a test runner.
- Match existing code style: JSDoc-style `/** ... */` comments above exported functions/methods in backend files (every existing controller/service file does this); no such comments in frontend `.tsx`/`.ts` files (none of the existing ones have them).

---

### Task 1: Add `categories.color` column

**Files:**
- Modify: `backend/src/config/db.ts`
- Test: `backend/src/config/db.test.ts`

**Interfaces:**
- Produces: `categories` rows now have a `color TEXT NOT NULL DEFAULT '#6b9478'` column, readable/writable through the existing `db` singleton exported from this file.

- [ ] **Step 1: Write the failing test**

Add to the bottom of `backend/src/config/db.test.ts`:

```ts
test('categories table has a color column with a default value', () => {
    db.prepare('INSERT INTO categories (name) VALUES (?)').run('Groceries');

    const row = db.prepare('SELECT * FROM categories WHERE name = ?').get('Groceries') as
        {id: number, name: string, color: string} | undefined;

    assert.ok(row);
    assert.equal(row.color, '#6b9478');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/config/db.test.ts`
Expected: FAIL — `color` is `undefined` (or SQLite rejects the insert if a later step already added a NOT NULL column with no default; right now the column doesn't exist at all, so the assertion on `row.color` fails).

- [ ] **Step 3: Write minimal implementation**

In `backend/src/config/db.ts`, after the existing `db.exec(...)` block that creates the tables, add a guarded migration:

```ts
db.exec(`
    PRAGMA foreign_keys = ON;
    
    CREATE TABLE IF NOT EXISTS categories(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
    ) STRICT;
    
    CREATE TABLE IF NOT EXISTS bills(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31)
    ) STRICT;
    
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        description TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        category_id INTEGER,
        bill_id INTEGER,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
        FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE SET NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
    ) STRICT;
`)

// SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so guard it by
// checking the column list first — this runs every process start, but only
// ever ALTERs once per database file.
const categoryColumns = db.prepare("SELECT name FROM pragma_table_info('categories')").all() as {name: string}[];
if (!categoryColumns.some((c) => c.name === 'color')) {
    db.exec(`ALTER TABLE categories ADD COLUMN color TEXT NOT NULL DEFAULT '#6b9478'`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/config/db.test.ts`
Expected: PASS (2 tests: the existing sessions test and the new categories test)

- [ ] **Step 5: Commit**

```bash
git add backend/src/config/db.ts backend/src/config/db.test.ts
git commit -m "Add color column to categories table"
```

---

### Task 2: Category type and validation

**Files:**
- Create: `backend/src/types/category.ts`
- Create: `backend/src/types/categoryApiResult.ts`
- Create: `backend/src/helpers/categoryValidation.ts`
- Test: `backend/src/helpers/categoryValidation.test.ts`

**Interfaces:**
- Produces: `Category = {id: number, name: string, color: string}`, `NewCategory = Omit<Category, 'id'>`, and `validateCategory(body: unknown): CategoryApiResult` where `CategoryApiResult = {ok: true, value: NewCategory} | {ok: false, error: string}`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/helpers/categoryValidation.test.ts`:

```ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCategory} from './categoryValidation.ts';

test('rejects a non-object body', () => {
    const result = validateCategory('nope');
    assert.equal(result.ok, false);
});

test('rejects a missing name', () => {
    const result = validateCategory({color: '#6b9478'});
    assert.equal(result.ok, false);
});

test('rejects an empty name', () => {
    const result = validateCategory({name: '   ', color: '#6b9478'});
    assert.equal(result.ok, false);
});

test('rejects a missing color', () => {
    const result = validateCategory({name: 'Groceries'});
    assert.equal(result.ok, false);
});

test('rejects a malformed color', () => {
    const result = validateCategory({name: 'Groceries', color: 'green'});
    assert.equal(result.ok, false);
});

test('accepts a valid category and returns the normalized value', () => {
    const result = validateCategory({name: 'Groceries', color: '#6b9478'});
    assert.deepEqual(result, {ok: true, value: {name: 'Groceries', color: '#6b9478'}});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/helpers/categoryValidation.test.ts`
Expected: FAIL — `categoryValidation.ts` does not exist yet (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/types/category.ts`:

```ts
export type Category = {
    id: number;
    name: string;
    color: string;
}

export type NewCategory = Omit<Category, 'id'>;
```

Create `backend/src/types/categoryApiResult.ts`:

```ts
import type {NewCategory} from "./category.ts";

export type CategoryApiResult =
    | { ok: true, value: NewCategory }
    | { ok: false, error: string };
```

Create `backend/src/helpers/categoryValidation.ts`:

```ts
import type {CategoryApiResult} from "../types/categoryApiResult.ts";

const COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * @desc Validate a category object
 * @desc Returns a CategoryApiResult with either the validated category or an error message
 * @param body
 */
export function validateCategory(body: unknown): CategoryApiResult {
    // Return false if it isn't an object
    if (typeof body !== 'object' || body === null) {
        return {ok: false, error: 'Body must be a JSON Object'}
    }

    const b = body as Record<string, unknown>;

    // Return false if name is not a string or is missing
    if (typeof b.name !== 'string' || b.name.trim() === '') {
        return {ok: false, error: 'name is required'}
    }

    // Return false if color is not a hex color string
    if (typeof b.color !== 'string' || !COLOR.test(b.color)) {
        return {ok: false, error: 'color must be a hex string like #6b9478'}
    }

    return {
        ok: true,
        value: {
            name: b.name,
            color: b.color,
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/helpers/categoryValidation.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/types/category.ts backend/src/types/categoryApiResult.ts backend/src/helpers/categoryValidation.ts backend/src/helpers/categoryValidation.test.ts
git commit -m "Add Category type and validateCategory helper"
```

---

### Task 3: CategoryService

**Files:**
- Create: `backend/src/services/categories.service.ts`
- Test: `backend/src/services/categories.service.test.ts`

**Interfaces:**
- Consumes: `db` from `../config/db.ts` (Task 1), `Category`/`NewCategory` from `../types/category.ts` (Task 2).
- Produces: `CategoryService` with `getAllCategories(): Category[]`, `getCategoryById(id: number): Category | undefined`, `createCategory(c: NewCategory): Category`, `updateCategory(id: number, c: NewCategory): Category | undefined`, `deleteCategory(id: number): {changes: number}`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/categories.service.test.ts`:

```ts
import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_FILE = ':memory:';
const {CategoryService} = await import('./categories.service.ts');

const service = new CategoryService();

test('createCategory inserts and returns the category with an id', () => {
    const created = service.createCategory({name: 'Groceries', color: '#6b9478'});
    assert.ok(created.id);
    assert.equal(created.name, 'Groceries');
    assert.equal(created.color, '#6b9478');
});

test('getCategoryById returns undefined for a missing id', () => {
    assert.equal(service.getCategoryById(999999), undefined);
});

test('getAllCategories returns categories ordered by name', () => {
    service.createCategory({name: 'Zzzzz Sort Test', color: '#c06c52'});
    service.createCategory({name: 'Aaaaa Sort Test', color: '#c99a3c'});
    const names = service.getAllCategories().map((c) => c.name);
    assert.ok(names.indexOf('Aaaaa Sort Test') < names.indexOf('Zzzzz Sort Test'));
});

test('updateCategory changes name and color and returns the row', () => {
    const created = service.createCategory({name: 'Dining', color: '#c06c52'});
    const updated = service.updateCategory(created.id, {name: 'Dining Out', color: '#c99a3c'});
    assert.equal(updated?.name, 'Dining Out');
    assert.equal(updated?.color, '#c99a3c');
});

test('updateCategory returns undefined for a missing id', () => {
    const updated = service.updateCategory(999999, {name: 'Nope', color: '#000000'});
    assert.equal(updated, undefined);
});

test('deleteCategory removes the row and reports changes', () => {
    const created = service.createCategory({name: 'Temp', color: '#000000'});
    const {changes} = service.deleteCategory(created.id);
    assert.equal(changes, 1);
    assert.equal(service.getCategoryById(created.id), undefined);
});

test('deleting a category sets category_id to null on referencing transactions', async () => {
    const {TransactionService} = await import('./transactions.service.ts');
    const transactionService = new TransactionService();

    const category = service.createCategory({name: 'Will Be Deleted', color: '#000000'});
    const transaction = transactionService.createTransaction({
        date: '2026-01-01', description: 'Test row', amount_cents: -500, category_id: category.id, bill_id: null,
    });

    service.deleteCategory(category.id);

    const reloaded = transactionService.getTransactionById(transaction.id);
    assert.equal(reloaded?.category_id, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/services/categories.service.test.ts`
Expected: FAIL — `categories.service.ts` does not exist yet (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/services/categories.service.ts`:

```ts
import {db} from "../config/db.ts";
import type {Category, NewCategory} from "../types/category.ts";

export class CategoryService {
    /**
     * Retrieves all categories from the database, ordered alphabetically by name.
     *
     * @return {Category[]} An array of categories sorted A-Z by name.
     */
    getAllCategories() {
        return db.prepare('SELECT * FROM categories ORDER BY name').all() as Category[];
    }

    /**
     * Retrieves a category by its unique identifier.
     *
     * @param id The unique identifier of the category to retrieve.
     * @return The matching category, or undefined if no category is found.
     */
    getCategoryById(id: number) {
        return db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Category | undefined;
    }

    /**
     * Creates a new category record in the database and returns the inserted category.
     *
     * @param category The category data to insert, including name and color.
     * @return The newly created category record.
     */
    createCategory(category: NewCategory) {
        return db.prepare('INSERT INTO categories (name, color) VALUES (?, ?) RETURNING *')
            .get(category.name, category.color) as Category;
    }

    /**
     * Updates an existing category record with the provided category data.
     *
     * @param id The unique identifier of the category to update.
     * @param category The new category data to apply.
     * @return The updated category record, or undefined if no category was updated.
     */
    updateCategory(id: number, category: NewCategory) {
        return db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ? RETURNING *')
            .get(category.name, category.color, id) as Category | undefined;
    }

    /**
     * Deletes a category with the specified identifier from the database.
     *
     * @param id The unique identifier of the category to delete.
     * @return The result of the delete operation, including the number of affected rows.
     */
    deleteCategory(id: number) {
        return db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/services/categories.service.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/categories.service.ts backend/src/services/categories.service.test.ts
git commit -m "Add CategoryService"
```

---

### Task 4: Categories controller, router, and wiring

**Files:**
- Create: `backend/src/controllers/categories.controller.ts`
- Create: `backend/src/routes/categories.router.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/routes/categories.test.ts`

**Interfaces:**
- Consumes: `CategoryService` (Task 3), `validateCategory` (Task 2), `requireAuth` from `../middleware/requireAuth.ts` (existing).
- Produces: `categoriesRouter` (Express router) mounted at `/api/v1/categories`, behind `requireAuth`. Response envelopes: `{data: ...}` on success, `{error: "..."}` on failure.

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/categories.test.ts`:

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

test('/api/v1/categories requires authentication', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/categories`);
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('creates a category and returns it with an id', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/categories`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Groceries', color: '#6b9478'}),
        });
        assert.equal(res.status, 201);
        const body = await res.json();
        assert.ok(body.data.id);
        assert.equal(body.data.name, 'Groceries');
    } finally {
        await close();
    }
});

test('rejects a category with an invalid color', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/categories`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Bad Color', color: 'not-a-color'}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('rejects a duplicate category name', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        await fetch(`${url}/api/v1/categories`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Rent', color: '#c06c52'}),
        });
        const res = await fetch(`${url}/api/v1/categories`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Rent', color: '#c99a3c'}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('updates a category', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const createRes = await fetch(`${url}/api/v1/categories`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Dining', color: '#c06c52'}),
        });
        const {data: created} = await createRes.json();

        const updateRes = await fetch(`${url}/api/v1/categories/${created.id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Dining Out', color: '#c99a3c'}),
        });
        assert.equal(updateRes.status, 200);
        const {data: updated} = await updateRes.json();
        assert.equal(updated.name, 'Dining Out');
    } finally {
        await close();
    }
});

test('deleting a category 404s when it does not exist', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/categories/999999`, {
            method: 'DELETE',
            headers: {Cookie: cookie},
        });
        assert.equal(res.status, 404);
    } finally {
        await close();
    }
});

test('deletes a category', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const createRes = await fetch(`${url}/api/v1/categories`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Temp Category', color: '#000000'}),
        });
        const {data: created} = await createRes.json();

        const deleteRes = await fetch(`${url}/api/v1/categories/${created.id}`, {
            method: 'DELETE',
            headers: {Cookie: cookie},
        });
        assert.equal(deleteRes.status, 204);
    } finally {
        await close();
    }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/routes/categories.test.ts`
Expected: FAIL — `GET/POST /api/v1/categories` doesn't exist yet, so every request 404s and the assertions on status codes fail.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/controllers/categories.controller.ts`:

```ts
import type { Request, Response } from 'express';
import {validateCategory} from "../helpers/categoryValidation.ts";
import {CategoryService} from "../services/categories.service.ts";

const categoryService = new CategoryService();

/**
 * Retrieves all categories from the database, ordered alphabetically by name,
 * and sends them in a JSON response.
 *
 * @param _req - The incoming request object. This parameter is not used.
 * @param res - The response object used to send the category data.
 * @return The HTTP response containing the list of categories.
 */
export function getAllCategories(_req: Request, res: Response) {
    const categories = categoryService.getAllCategories();
    return res.status(200).json({data: categories});
}

/**
 * Retrieves a category by its numeric identifier from the request parameters and sends the result as a JSON response.
 *
 * @param req Express request containing the category id route parameter.
 * @param res Express response used to send validation errors, not found errors, or the category data.
 * @return The HTTP response containing either an error message or the requested category data.
 */
export function getCategoryById(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const category = categoryService.getCategoryById(id);
    if (!category) {
        return res.status(404).json({error: 'Category not found'});
    }

    return res.status(200).json({data: category});
}

/**
 * Creates a new category from the request body after validating the submitted data.
 * Responds with a 400 status and validation error when the request body is invalid.
 * Responds with a 201 status and the created category when insertion succeeds.
 * Responds with a 400 status when the category name already exists.
 *
 * @param req Express request containing the category data in the request body.
 * @param res Express response used to send the creation result or error response.
 * @return The Express response containing the created category or an error response.
 */
export function createCategory(req: Request, res: Response) {
    const result = validateCategory(req.body);
    if (!result.ok) {
        return res.status(400).json({error: result.error});
    }

    try {
        const created = categoryService.createCategory(result.value);
        return res.status(201).json({data: created});
    } catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
            return res.status(400).json({error: 'Category name already exists'});
        }
        throw err;
    }
}

/**
 * Updates an existing category by its request parameter id using the validated request body.
 *
 * @param req Express request containing the category id in the route parameters and updated category data in the body.
 * @param res Express response used to return the updated category or an error response.
 * @return A JSON response with the updated category, a validation error, a not found error, or a duplicate-name error.
 */
export function updateCategory(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const result = validateCategory(req.body);
    if (!result.ok) {
        return res.status(400).json({error: result.error});
    }

    try {
        const updated = categoryService.updateCategory(id, result.value);
        if (!updated) {
            return res.status(404).json({error: 'Category not found'});
        }
        return res.status(200).json({data: updated});
    } catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
            return res.status(400).json({error: 'Category name already exists'});
        }
        throw err;
    }
}

/**
 * Deletes a category identified by the request route parameter.
 *
 * @param req Express request containing the category id in the route parameters.
 * @param res Express response used to return the deletion result.
 * @return A response with status 204 when deleted, 400 when the id is invalid, or 404 when no category is found.
 */
export function deleteCategory(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const {changes} = categoryService.deleteCategory(id);
    if (changes === 0) {
        return res.status(404).json({error: 'Category not found'});
    }

    return res.status(204).end();
}
```

Create `backend/src/routes/categories.router.ts`:

```ts
import express from "express";
import {
    createCategory, deleteCategory, getAllCategories, getCategoryById, updateCategory
} from "../controllers/categories.controller.ts";

export const categoriesRouter = express.Router()

categoriesRouter.get('/', getAllCategories);
categoriesRouter.post('/', createCategory);
categoriesRouter.get('/:id', getCategoryById);
categoriesRouter.put('/:id', updateCategory);
categoriesRouter.delete('/:id', deleteCategory);
```

Modify `backend/src/app.ts` — add the import and mount the router next to `transactionsRouter`:

```ts
import express, {type Request, type Response} from 'express';
import {fileURLToPath} from 'node:url';
import {transactionsRouter} from './routes/transactions.router.ts'
import {categoriesRouter} from './routes/categories.router.ts'
import {authRouter} from './routes/auth.router.ts'
import {requireAuth} from './middleware/requireAuth.ts'

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Routes
app.use('/api/v1/auth', authRouter)
app.use('/api/v1/transactions', requireAuth, transactionsRouter)
app.use('/api/v1/categories', requireAuth, categoriesRouter)
```

(Leave the rest of `app.ts` — the `GET /`, the `listen` guard, and the `export default app` — unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/routes/categories.test.ts`
Expected: PASS (7 tests)

Then run the full backend suite to make sure nothing else broke:

Run: `cd backend && npm test`
Expected: PASS (all existing + new tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/categories.controller.ts backend/src/routes/categories.router.ts backend/src/routes/categories.test.ts backend/src/app.ts
git commit -m "Add categories controller, router, and mount under /api/v1/categories"
```

---

### Task 5: Frontend Category type and CategoryApiService

**Files:**
- Create: `frontend/src/types/category.ts`
- Create: `frontend/src/services/CategoryApiService.ts`

**Interfaces:**
- Consumes: `BaseApiService` from `./BaseApiService.ts` (existing).
- Produces: `Category = {id: number, name: string, color: string}`, `NewCategory = Omit<Category, 'id'>`, and a singleton `categoryApiService` with `getAllCategories(): Promise<Category[]>`, `createCategory(body: NewCategory): Promise<Category>`, `updateCategory(id: number, body: NewCategory): Promise<Category>`, `deleteCategory(id: number): Promise<void>`.

- [ ] **Step 1: Create the type**

Create `frontend/src/types/category.ts`:

```ts
export type Category = {
    id: number;
    name: string;
    color: string;
}

export type NewCategory = Omit<Category, 'id'>;
```

- [ ] **Step 2: Create the API service**

Create `frontend/src/services/CategoryApiService.ts`:

```ts
import {BaseApiService} from "./BaseApiService.ts";
import type {Category, NewCategory} from "../types/category.ts";

export class CategoryApiService extends BaseApiService {

    constructor() {
        super('/categories');
    }

    getAllCategories(): Promise<Category[]> {
        return this.getAll<Category[]>();
    }

    createCategory(body: NewCategory): Promise<Category> {
        return this.create<Category>(body);
    }

    updateCategory(id: number, body: NewCategory): Promise<Category> {
        return this.update<Category>(id, body);
    }

    deleteCategory(id: number): Promise<void> {
        return this.delete(id);
    }
}

export const categoryApiService = new CategoryApiService();
```

- [ ] **Step 3: Verify it compiles**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/category.ts frontend/src/services/CategoryApiService.ts
git commit -m "Add frontend Category type and CategoryApiService"
```

---

### Task 6: Categories page, route, and nav link

**Files:**
- Create: `frontend/src/categories/Categories.tsx`
- Create: `frontend/src/categories/Categories.css`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/Layout.tsx`

**Interfaces:**
- Consumes: `categoryApiService` (Task 5), `Category`/`NewCategory` (Task 5).
- Produces: a `/categories` route rendering a page where categories can be listed, added, edited, and deleted.

- [ ] **Step 1: Create the page component**

Create `frontend/src/categories/Categories.tsx`:

```tsx
import {useEffect, useState} from "react";
import {categoryApiService} from "../services/CategoryApiService.ts";
import type {Category} from "../types/category.ts";
import "../styles/ledger.css"
import './Categories.css'

const DEFAULT_COLOR = '#6b9478';

function Categories() {
    const [categories, setCategories] = useState<Category[]>();
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const [newName, setNewName] = useState('');
    const [newColor, setNewColor] = useState(DEFAULT_COLOR);

    const [editingId, setEditingId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');
    const [editColor, setEditColor] = useState(DEFAULT_COLOR);

    useEffect(() => {
        categoryApiService.getAllCategories().then((c) => {
            setCategories(c);
        }).catch((err) => {
            setError(err.message);
        }).finally(() => {
            setLoading(false);
        });
    }, []);

    async function handleAdd() {
        if (newName.trim() === '') {
            return;
        }

        setError(null);
        try {
            const created = await categoryApiService.createCategory({name: newName.trim(), color: newColor});
            setCategories((prev) => [...(prev ?? []), created].sort((a, b) => a.name.localeCompare(b.name)));
            setNewName('');
            setNewColor(DEFAULT_COLOR);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not create this category');
        }
    }

    function startEdit(category: Category) {
        setEditingId(category.id);
        setEditName(category.name);
        setEditColor(category.color);
    }

    async function handleSaveEdit(id: number) {
        if (editName.trim() === '') {
            return;
        }

        setError(null);
        try {
            const updated = await categoryApiService.updateCategory(id, {name: editName.trim(), color: editColor});
            setCategories((prev) => (prev ?? []).map((c) => c.id === id ? updated : c));
            setEditingId(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not update this category');
        }
    }

    async function handleDelete(id: number) {
        setError(null);
        try {
            await categoryApiService.deleteCategory(id);
            setCategories((prev) => (prev ?? []).filter((c) => c.id !== id));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete this category');
        }
    }

    return (
        <>
            <div className="category-add">
                <input
                    type="color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    aria-label="New category color"
                />
                <input
                    type="text"
                    placeholder="New category name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                />
                <button type="button" onClick={handleAdd} disabled={newName.trim() === ''}>
                    Add category
                </button>
            </div>

            {loading && <p className="ledger-status">Loading categories…</p>}
            {error && <p className="ledger-status error">{error}</p>}
            {!loading && !error && categories?.length === 0 && (
                <p className="ledger-status">No categories yet.</p>
            )}

            {!loading && !error && (categories ?? []).map((category) => (
                <article className="ledger-row category-row" key={category.id}>
                    {editingId === category.id ? (
                        <>
                            <input
                                type="color"
                                value={editColor}
                                onChange={(e) => setEditColor(e.target.value)}
                                aria-label={`Edit color for ${category.name}`}
                            />
                            <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                aria-label={`Edit name for ${category.name}`}
                            />
                            <div className="category-row__actions">
                                <button type="button" onClick={() => handleSaveEdit(category.id)}>Save</button>
                                <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                            </div>
                        </>
                    ) : (
                        <>
                            <span className="category-swatch" style={{backgroundColor: category.color}}/>
                            <span className="category-name">{category.name}</span>
                            <div className="category-row__actions">
                                <button type="button" onClick={() => startEdit(category)}>Edit</button>
                                <button type="button" onClick={() => handleDelete(category.id)}>Delete</button>
                            </div>
                        </>
                    )}
                </article>
            ))}
        </>
    )
}

export default Categories
```

- [ ] **Step 2: Create the page styles**

Create `frontend/src/categories/Categories.css`:

```css
.category-add {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.category-add input[type="text"] {
  font-family: var(--sans);
  font-size: 0.9rem;
  color: var(--text-on-ink-strong);
  background: var(--ink-raised);
  border: 1px solid var(--rule-on-ink);
  border-radius: 4px;
  padding: 0.5rem 0.7rem;
  flex: 1;
}

.category-add input[type="color"] {
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid var(--rule-on-ink);
  border-radius: 4px;
  background: none;
  cursor: pointer;
  padding: 0;
}

.category-add input[type="text"]:focus-visible,
.category-add button:focus-visible {
  outline: 2px solid var(--due);
  outline-offset: 2px;
}

.category-add button,
.category-row__actions button {
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

.category-add button:hover,
.category-row__actions button:hover {
  border-color: var(--text-on-ink);
}

.category-add button:disabled {
  opacity: 0.5;
  cursor: default;
}

.category-row {
  gap: 0.85rem;
}

.category-swatch {
  width: 1rem;
  height: 1rem;
  border-radius: 999px;
  flex-shrink: 0;
}

.category-name {
  font-family: var(--sans);
  font-weight: 500;
  flex: 1;
}

.category-row__actions {
  display: flex;
  gap: 0.5rem;
  margin-left: auto;
}

@media (max-width: 640px) {
  .category-add {
    flex-wrap: wrap;
  }
}
```

- [ ] **Step 3: Wire the route**

In `frontend/src/main.tsx`, add the import and the route:

```tsx
import Import from './import/Import.tsx'
import Categories from './categories/Categories.tsx'
```

```tsx
<Route path="/import" element={<Import/>}/>
<Route path="/categories" element={<Categories/>}/>
```

- [ ] **Step 4: Add the nav link**

In `frontend/src/Layout.tsx`, add a link in `tape-nav`:

```tsx
<NavLink to="/import" className={navClass}>Import</NavLink>
<NavLink to="/categories" className={navClass}>Categories</NavLink>
```

- [ ] **Step 5: Verify it compiles and works**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors.

Run: `cd frontend && npm run dev`, open the app, log in, click "Categories" in the nav. Add a category (name + color), edit it, delete it. Confirm the list stays sorted by name after adding.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/categories frontend/src/main.tsx frontend/src/Layout.tsx
git commit -m "Add Categories management page"
```

---

### Task 7: Replace `categoryLabel` with a real name lookup

**Files:**
- Modify: `frontend/src/helpers/ledger.ts`

**Interfaces:**
- Consumes: `Category` type (Task 5).
- Produces: `categoryName(categories: Category[], categoryId: number | null): string`, replacing the removed `categoryLabel(categoryId: number | null): string`.

- [ ] **Step 1: Replace the helper**

In `frontend/src/helpers/ledger.ts`, add the import and replace `categoryLabel`:

```ts
import type {Category} from "../types/category.ts";

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', {month: 'long', year: 'numeric'});

export function monthKey(date: string): string {
    return date.slice(0, 7);
}

export function monthLabel(key: string): string {
    const [year, month] = key.split('-').map(Number);
    return MONTH_LABEL.format(new Date(year, month - 1, 1));
}

export function shiftMonth(key: string, delta: number): string {
    const [year, month] = key.split('-').map(Number);
    const next = new Date(year, month - 1 + delta, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

export function categoryName(categories: Category[], categoryId: number | null): string {
    if (categoryId === null) {
        return 'Uncategorized';
    }
    return categories.find((c) => c.id === categoryId)?.name ?? 'Uncategorized';
}
```

(This step intentionally breaks the build — `App.tsx` and `Transactions.tsx` still import the now-removed `categoryLabel`. That's fixed in Tasks 8 and 9, which must land right after this one.)

- [ ] **Step 2: Commit**

```bash
git add frontend/src/helpers/ledger.ts
git commit -m "Replace categoryLabel placeholder with a real categoryName lookup"
```

---

### Task 8: Dashboard (App.tsx) uses real category names

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `categoryApiService` (Task 5), `categoryName` (Task 7).

This keeps the current `/dashboard` compiling and showing real names — it is **not** the dashboard redesign (that's a separate follow-on project).

- [ ] **Step 1: Fetch categories and use the lookup**

In `frontend/src/App.tsx`, update the imports and add a categories fetch:

```tsx
import {useEffect, useMemo, useState} from "react";
import {transactionApiService} from "./services/TransactionApiService.ts";
import {categoryApiService} from "./services/CategoryApiService.ts";
import type {Transaction} from "./types/transaction.ts";
import type {Category} from "./types/category.ts";
import {formatMoney} from "./helpers/money.ts";
import {categoryName, monthKey, monthLabel, shiftMonth} from "./helpers/ledger.ts";
import "./styles/ledger.css"
import './App.css'

function App() {
    const [transactions, setTransactions] = useState<Transaction[]>();
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [month, setMonth] = useState<string>(() => monthKey(new Date().toISOString()));

    useEffect(() => {
        transactionApiService.getAllTransactions().then((t) => {
            setTransactions(t)
            if (t.length && !t.some((tx) => monthKey(tx.date) === month)) {
                setMonth(monthKey([...t].sort((a, b) => b.date.localeCompare(a.date))[0].date))
            }
        }).catch((err) => {
            setError(err.message)
        }).finally(() => {
            setLoading(false)
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        categoryApiService.getAllCategories().then(setCategories).catch(() => {});
    }, [])
```

(The rest of the component is unchanged except the one render line below.)

Replace the category pill render:

```tsx
<span className="ledger-category">{categoryLabel(t.category_id)}</span>
```

with:

```tsx
<span className="ledger-category">{categoryName(categories, t.category_id)}</span>
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 3: Manually verify**

Run: `cd frontend && npm run dev`, open `/dashboard`, confirm transactions with a category show the category's real name (not `Cat #N`), and uncategorized transactions still show "Uncategorized".

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "Show real category names on the dashboard"
```

---

### Task 9: Transactions page gets an inline category picker

**Files:**
- Modify: `frontend/src/transactions/Transactions.tsx`
- Modify: `frontend/src/transactions/Transactions.css`

**Interfaces:**
- Consumes: `categoryApiService` (Task 5), `categoryName` (Task 7), `transactionApiService.updateTransaction` (existing).

- [ ] **Step 1: Update imports and add categories state**

In `frontend/src/transactions/Transactions.tsx`, update the top of the file:

```tsx
import {useEffect, useMemo, useState} from "react";
import type {Transaction} from "../types/transaction.ts";
import type {Category} from "../types/category.ts";
import {transactionApiService} from "../services/TransactionApiService.ts";
import {categoryApiService} from "../services/CategoryApiService.ts";
import {formatMoney} from "../helpers/money.ts";
import {categoryName, monthKey, monthLabel} from "../helpers/ledger.ts";
import "../styles/ledger.css"
import './Transactions.css'

const ALL_MONTHS = 'all';
const ALL_CATEGORIES = 'all';
const UNCATEGORIZED = 'uncategorized';

function categoryFilterKey(categoryId: number | null): string {
    return categoryId === null ? UNCATEGORIZED : String(categoryId);
}

function Transactions() {
    const [transactions, setTransactions] = useState<Transaction[]>();
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [month, setMonth] = useState<string>(ALL_MONTHS);
    const [category, setCategory] = useState<string>(ALL_CATEGORIES);
    const [editingCategoryFor, setEditingCategoryFor] = useState<number | null>(null);

    useEffect(() => {
        transactionApiService.getAllTransactions().then((t) => {
            setTransactions(t)
        }).catch((err) => {
            setError(err.message)
        }).finally(() => {
            setLoading(false)
        })
    }, [])

    useEffect(() => {
        categoryApiService.getAllCategories().then(setCategories).catch(() => {});
    }, [])
```

- [ ] **Step 2: Rename the derived filter-key memo and relabel the filter dropdown**

Replace the existing `categories` memo (it collides with the new state variable) and the filter `<select>` options:

```tsx
    const categoryFilterKeys = useMemo(() => {
        const keys = new Set(sorted.map((t) => categoryFilterKey(t.category_id)))
        return [...keys].sort()
    }, [sorted])
```

```tsx
    const filtered = useMemo(
        () => sorted.filter((t) =>
            (month === ALL_MONTHS || monthKey(t.date) === month) &&
            (category === ALL_CATEGORIES || categoryFilterKey(t.category_id) === category)
        ),
        [sorted, month, category]
    )
```

```tsx
                <label className="ledger-filter">
                    <span>Category</span>
                    <select value={category} onChange={(e) => setCategory(e.target.value)}>
                        <option value={ALL_CATEGORIES}>All categories</option>
                        {categoryFilterKeys.map((key) => (
                            <option key={key} value={key}>
                                {key === UNCATEGORIZED ? 'Uncategorized' : categoryName(categories, Number(key))}
                            </option>
                        ))}
                    </select>
                </label>
```

- [ ] **Step 3: Add the category-change handler**

Add this function inside `Transactions`, above the `return`:

```tsx
    async function handleCategoryChange(t: Transaction, value: string) {
        const category_id = value === '' ? null : Number(value);
        setEditingCategoryFor(null);
        setError(null);
        try {
            const updated = await transactionApiService.updateTransaction(t.id, {
                date: t.date,
                description: t.description,
                amount_cents: t.amount_cents,
                category_id,
                bill_id: t.bill_id,
            });
            setTransactions((prev) => (prev ?? []).map((tx) => tx.id === t.id ? updated : tx));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not update this transaction's category");
        }
    }
```

- [ ] **Step 4: Replace the read-only pill with the inline picker**

Replace:

```tsx
<span className="ledger-category">{categoryLabel(t.category_id)}</span>
```

with:

```tsx
{editingCategoryFor === t.id ? (
    <select
        className="ledger-category-select"
        autoFocus
        value={t.category_id ?? ''}
        onChange={(e) => handleCategoryChange(t, e.target.value)}
        onBlur={() => setEditingCategoryFor(null)}
    >
        <option value="">Uncategorized</option>
        {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
        ))}
    </select>
) : (
    <button
        type="button"
        className="ledger-category ledger-category-button"
        onClick={() => setEditingCategoryFor(t.id)}
    >
        {categoryName(categories, t.category_id)}
    </button>
)}
```

- [ ] **Step 5: Add styles for the clickable pill and the select**

Add to `frontend/src/transactions/Transactions.css`:

```css
.ledger-category-button {
  background: none;
  cursor: pointer;
}

.ledger-category-button:hover {
  border-color: var(--text-on-ink);
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

- [ ] **Step 6: Verify it compiles**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 7: Manually verify**

Run: `cd frontend && npm run dev`, open `/transactions`, click a category pill, pick a different category from the dropdown, confirm it saves immediately and the pill updates. Confirm the category filter dropdown shows real names.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/transactions/Transactions.tsx frontend/src/transactions/Transactions.css
git commit -m "Add inline category picker to the Transactions page"
```
