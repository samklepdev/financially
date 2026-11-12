# Recurring Bills / Subscriptions Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the dormant `bills` table into a full vertical slice (CRUD + `/bills` UI), auto-link new transactions to a bill by description match, and auto-suggest recurring bills from transaction history — then surface due/overdue bills on the dashboard.

**Architecture:** A new `bills` backend vertical slice (`types/`, `helpers/billValidation.ts`, `services/bill.service.ts`, `controllers/bill.controller.ts`, `routes/bill.router.ts`) mirrors the existing `categories`/`category_rules` slices exactly. Two read-only service methods (`getUpcomingBills`, `getSuggestedBills`) compute derived state from `transactions` on every call — nothing new is persisted beyond the one additive `bills.match_pattern` column. The import and manual-add transaction paths gain one more signal lookup (bill match) alongside the existing category signals. The frontend gets a new `/bills` page (mirrors `/rules`), a bill `<select>` on the transaction add/edit forms, and an "Upcoming Bills" card on the dashboard.

**Tech Stack:** Node 26+, Express 5, `node:sqlite` (`DatabaseSync`), TypeScript (no build step, explicit `.ts` import extensions), `node --test`, React 19 + Vite + Axios.

## Global Constraints

- Every test file that touches `db.ts` sets `process.env.DATABASE_FILE = ':memory:'` before the first dynamic `import` of anything touching `db.ts`, then `await import(...)`.
- Backend exported functions/methods get a JSDoc `/** ... */` block. Frontend `.tsx`/`.ts` files get no such comments.
- All date arithmetic uses `Date.UTC`/`getUTCDate`/`setUTCDate`/`getUTCFullYear`/`getUTCMonth` — never the non-UTC `Date` methods — per the timezone bug fixed in the dashboard-charts project.
- New backend vertical slices mirror the `categories`/`category_rules` slice exactly: `types/`, `helpers/<x>Validation.ts`, `services/<x>.service.ts`, `controllers/<x>.controller.ts`, `routes/<x>.router.ts`, mounted in `app.ts` behind `requireAuth`.
- HTTP error-envelope conventions: `400` on bad id/body, `404` on not found, `201` on create, `200` on read/update, `204` on delete, body always `{data: ...}` or `{error: "message"}`.
- Frontend verification is `npx tsc -b --noEmit` plus manual checks in the running app (no frontend test framework).
- Route ordering: any literal-path route (e.g. `/upcoming`) must be registered before the `/:id` parameterized route in the same router, or Express will try to match it as an id.

---

### Task 1: `bills` schema column, types, and validation

**Files:**
- Modify: `backend/src/config/db.ts`
- Create: `backend/src/types/bill.ts`
- Create: `backend/src/types/billApiResult.ts`
- Create: `backend/src/helpers/billValidation.ts`
- Test: `backend/src/helpers/billValidation.test.ts`

**Interfaces:**
- Produces: `Bill = {id: number, name: string, amount_cents: number, due_day: number, match_pattern: string}`, `NewBill = Omit<Bill, 'id'>`, `BillApiResult = {ok: true, value: NewBill} | {ok: false, error: string}`, `validateBill(body: unknown): BillApiResult`.

- [ ] **Step 1: Add the guarded `match_pattern` column**

In `backend/src/config/db.ts`, after the existing `categories.color` guarded `ALTER TABLE` block (the block ending at line 53), add:

```ts
const billColumns = db.prepare("SELECT name FROM pragma_table_info('bills')").all() as {name: string}[];
if (!billColumns.some((c) => c.name === 'match_pattern')) {
    db.exec(`ALTER TABLE bills ADD COLUMN match_pattern TEXT NOT NULL DEFAULT ''`);
}
```

- [ ] **Step 2: Create the `Bill` type**

Create `backend/src/types/bill.ts`:

```ts
export type Bill = {
    id: number;
    name: string;
    amount_cents: number;
    due_day: number;
    match_pattern: string;
}

export type NewBill = Omit<Bill, 'id'>;
```

- [ ] **Step 3: Create the `BillApiResult` type**

Create `backend/src/types/billApiResult.ts`:

```ts
import type {NewBill} from "./bill.ts";

export type BillApiResult =
    | { ok: true, value: NewBill }
    | { ok: false, error: string };
```

- [ ] **Step 4: Write the failing validation tests**

Create `backend/src/helpers/billValidation.test.ts`:

```ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateBill} from './billValidation.ts';

test('rejects a non-object body', () => {
    const result = validateBill('nope');
    assert.equal(result.ok, false);
});

test('rejects a missing name', () => {
    const result = validateBill({amount_cents: 1599, due_day: 5, match_pattern: 'netflix'});
    assert.equal(result.ok, false);
});

test('rejects a non-positive amount_cents', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 0, due_day: 5, match_pattern: 'netflix'});
    assert.equal(result.ok, false);
});

test('rejects a due_day outside 1-31', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 32, match_pattern: 'netflix'});
    assert.equal(result.ok, false);
});

test('rejects a non-string match_pattern', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: null});
    assert.equal(result.ok, false);
});

test('accepts an empty match_pattern', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: ''});
    assert.equal(result.ok, true);
});

test('accepts a fully valid bill', () => {
    const result = validateBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix'});
    assert.deepEqual(result, {
        ok: true,
        value: {name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix'},
    });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd backend && npx tsc --noEmit` (will fail: `billValidation.ts` does not exist yet), then `node --test src/helpers/billValidation.test.ts`
Expected: FAIL — cannot find module `./billValidation.ts`

- [ ] **Step 6: Implement `validateBill`**

Create `backend/src/helpers/billValidation.ts`:

```ts
import type {BillApiResult} from "../types/billApiResult.ts";

/**
 * @desc Validate a bill object
 * @desc Returns a BillApiResult with either the validated bill or an error message
 * @param body
 */
export function validateBill(body: unknown): BillApiResult {
    // Return false if it isn't an object
    if (typeof body !== 'object' || body === null) {
        return {ok: false, error: 'Body must be a JSON Object'}
    }

    const b = body as Record<string, unknown>;

    // Return false if name is not a string or is missing
    if (typeof b.name !== 'string' || b.name.trim() === '') {
        return {ok: false, error: 'name is required'}
    }

    // Return false if amount_cents is not a positive integer
    if (!Number.isInteger(b.amount_cents) || (b.amount_cents as number) <= 0) {
        return {ok: false, error: 'amount_cents must be a positive whole number of cents'}
    }

    // Return false if due_day is not an integer between 1 and 31
    if (!Number.isInteger(b.due_day) || (b.due_day as number) < 1 || (b.due_day as number) > 31) {
        return {ok: false, error: 'due_day must be an integer between 1 and 31'}
    }

    // Return false if match_pattern is not a string
    if (typeof b.match_pattern !== 'string') {
        return {ok: false, error: 'match_pattern must be a string'}
    }

    return {
        ok: true,
        value: {
            name: b.name,
            amount_cents: b.amount_cents as number,
            due_day: b.due_day as number,
            match_pattern: b.match_pattern,
        }
    }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd backend && node --test src/helpers/billValidation.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 8: Commit**

```bash
git add backend/src/config/db.ts backend/src/types/bill.ts backend/src/types/billApiResult.ts backend/src/helpers/billValidation.ts backend/src/helpers/billValidation.test.ts
git commit -m "Add bills.match_pattern column, Bill type, and validation"
```

---

### Task 2: `BillService` CRUD and `findBillForDescription`

**Files:**
- Create: `backend/src/services/bill.service.ts`
- Test: `backend/src/services/bill.service.test.ts`

**Interfaces:**
- Consumes: `Bill`, `NewBill` from `../types/bill.ts` (Task 1).
- Produces: `class BillService` with `getAllBills(): Bill[]`, `getBillById(id: number): Bill | undefined`, `createBill(bill: NewBill): Bill`, `updateBill(id: number, bill: NewBill): Bill | undefined`, `deleteBill(id: number): {changes: number}`, `findBillForDescription(description: string): number | null`.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/bill.service.test.ts`:

```ts
import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_FILE = ':memory:';
const {BillService} = await import('./bill.service.ts');

const service = new BillService();

test('createBill inserts and returns the bill with an id', () => {
    const created = service.createBill({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix'});
    assert.ok(created.id);
    assert.equal(created.name, 'Netflix');
    assert.equal(created.amount_cents, 1599);
    assert.equal(created.due_day, 5);
    assert.equal(created.match_pattern, 'netflix');
});

test('getBillById returns undefined for a missing id', () => {
    assert.equal(service.getBillById(999999), undefined);
});

test('getAllBills returns bills ordered by name', () => {
    service.createBill({name: 'Zzzzz Sort Test', amount_cents: 500, due_day: 1, match_pattern: ''});
    service.createBill({name: 'Aaaaa Sort Test', amount_cents: 500, due_day: 1, match_pattern: ''});
    const names = service.getAllBills().map((b) => b.name);
    assert.ok(names.indexOf('Aaaaa Sort Test') < names.indexOf('Zzzzz Sort Test'));
});

test('updateBill changes fields and returns the row', () => {
    const created = service.createBill({name: 'Spotify', amount_cents: 1099, due_day: 10, match_pattern: 'spotify'});
    const updated = service.updateBill(created.id, {
        name: 'Spotify Premium', amount_cents: 1199, due_day: 12, match_pattern: 'spotify premium',
    });
    assert.equal(updated?.name, 'Spotify Premium');
    assert.equal(updated?.amount_cents, 1199);
    assert.equal(updated?.due_day, 12);
    assert.equal(updated?.match_pattern, 'spotify premium');
});

test('updateBill returns undefined for a missing id', () => {
    const updated = service.updateBill(999999, {name: 'Nope', amount_cents: 100, due_day: 1, match_pattern: ''});
    assert.equal(updated, undefined);
});

test('deleteBill removes the row and reports changes', () => {
    const created = service.createBill({name: 'Temp Bill', amount_cents: 500, due_day: 1, match_pattern: ''});
    const {changes} = service.deleteBill(created.id);
    assert.equal(changes, 1);
    assert.equal(service.getBillById(created.id), undefined);
});

test('deleting a bill sets bill_id to null on referencing transactions', async () => {
    const {TransactionService} = await import('./transactions.service.ts');
    const transactionService = new TransactionService();

    const bill = service.createBill({name: 'Will Be Deleted', amount_cents: 500, due_day: 1, match_pattern: ''});
    const transaction = transactionService.createTransaction({
        date: '2026-01-01', description: 'Test row', amount_cents: -500, category_id: null, bill_id: bill.id,
    });

    service.deleteBill(bill.id);

    const reloaded = transactionService.getTransactionById(transaction.id);
    assert.equal(reloaded?.bill_id, null);
});

test('findBillForDescription matches a case-insensitive substring', () => {
    service.createBill({name: 'Netflix Sub Test', amount_cents: 1599, due_day: 5, match_pattern: 'NETFLIX SUB TEST'});
    const billId = service.findBillForDescription('netflix sub test monthly charge');
    const bill = service.getAllBills().find((b) => b.id === billId);
    assert.equal(bill?.name, 'Netflix Sub Test');
});

test('findBillForDescription returns null when no pattern matches', () => {
    assert.equal(service.findBillForDescription('Some Unmatched Merchant XYZ'), null);
});

test('findBillForDescription ignores bills with an empty match_pattern', () => {
    service.createBill({name: 'No Pattern Bill', amount_cents: 500, due_day: 1, match_pattern: ''});
    assert.equal(service.findBillForDescription('No Pattern Bill'), null);
});

test('findBillForDescription picks the longest matching pattern', () => {
    service.createBill({name: 'Generic Pattern Test', amount_cents: 500, due_day: 1, match_pattern: 'Cash App'});
    service.createBill({name: 'Specific Pattern Test', amount_cents: 500, due_day: 1, match_pattern: 'Cash App Walmart'});
    const billId = service.findBillForDescription('Cash App Walmart Houston TX');
    const bill = service.getAllBills().find((b) => b.id === billId);
    assert.equal(bill?.name, 'Specific Pattern Test');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test src/services/bill.service.test.ts`
Expected: FAIL — cannot find module `./bill.service.ts`

- [ ] **Step 3: Implement `BillService`**

Create `backend/src/services/bill.service.ts`:

```ts
import {db} from "../config/db.ts";
import type {Bill, NewBill} from "../types/bill.ts";

export class BillService {
    /**
     * Retrieves all bills from the database, ordered alphabetically by name.
     *
     * @return {Bill[]} An array of bills sorted A-Z by name.
     */
    getAllBills() {
        return db.prepare('SELECT * FROM bills ORDER BY name').all() as Bill[];
    }

    /**
     * Retrieves a bill by its unique identifier.
     *
     * @param id The unique identifier of the bill to retrieve.
     * @return The matching bill, or undefined if no bill is found.
     */
    getBillById(id: number) {
        return db.prepare('SELECT * FROM bills WHERE id = ?').get(id) as Bill | undefined;
    }

    /**
     * Creates a new bill record in the database and returns the inserted bill.
     *
     * @param bill The bill data to insert, including name, amount_cents, due_day, and match_pattern.
     * @return The newly created bill record.
     */
    createBill(bill: NewBill) {
        return db.prepare(
            'INSERT INTO bills (name, amount_cents, due_day, match_pattern) VALUES (?, ?, ?, ?) RETURNING *'
        ).get(bill.name, bill.amount_cents, bill.due_day, bill.match_pattern) as Bill;
    }

    /**
     * Updates an existing bill record with the provided bill data.
     *
     * @param id The unique identifier of the bill to update.
     * @param bill The new bill data to apply.
     * @return The updated bill record, or undefined if no bill was updated.
     */
    updateBill(id: number, bill: NewBill) {
        return db.prepare(
            'UPDATE bills SET name = ?, amount_cents = ?, due_day = ?, match_pattern = ? WHERE id = ? RETURNING *'
        ).get(bill.name, bill.amount_cents, bill.due_day, bill.match_pattern, id) as Bill | undefined;
    }

    /**
     * Deletes a bill with the specified identifier from the database.
     *
     * @param id The unique identifier of the bill to delete.
     * @return The result of the delete operation, including the number of affected rows.
     */
    deleteBill(id: number) {
        return db.prepare('DELETE FROM bills WHERE id = ?').run(id);
    }

    /**
     * Finds the bill whose match_pattern is the longest case-insensitive
     * substring match of the given description. Bills with an empty
     * match_pattern never match. Used to auto-link a newly imported or
     * manually added transaction to a bill.
     *
     * @return The matching bill's id, or null if no bill's pattern matches.
     */
    findBillForDescription(description: string): number | null {
        const row = db.prepare(
            `SELECT id FROM bills
             WHERE match_pattern != '' AND instr(lower(?), lower(match_pattern)) > 0
             ORDER BY length(match_pattern) DESC LIMIT 1`
        ).get(description) as {id: number} | undefined;
        return row?.id ?? null;
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test src/services/bill.service.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/bill.service.ts backend/src/services/bill.service.test.ts
git commit -m "Add BillService CRUD and findBillForDescription"
```

---

### Task 3: `BillService.getUpcomingBills`

**Files:**
- Modify: `backend/src/services/bill.service.ts`
- Modify: `backend/src/services/bill.service.test.ts`

**Interfaces:**
- Consumes: `Bill` from `../types/bill.ts`, `db` from `../config/db.ts`.
- Produces: `type UpcomingBill = {bill: Bill, dueDate: string, status: 'paid' | 'overdue' | 'upcoming'}`, `BillService.getUpcomingBills(today?: Date): UpcomingBill[]`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/services/bill.service.test.ts`:

```ts
test('getUpcomingBills marks an unpaid bill due within 14 days as upcoming', () => {
    const today = new Date('2026-06-15T00:00:00Z');
    const bill = service.createBill({name: 'Upcoming Test Bill', amount_cents: 1000, due_day: 20, match_pattern: ''});

    const results = service.getUpcomingBills(today);
    const entry = results.find((r) => r.bill.id === bill.id);
    assert.equal(entry?.status, 'upcoming');
    assert.equal(entry?.dueDate, '2026-06-20');
});

test('getUpcomingBills marks an unpaid bill past its due date this cycle as overdue', () => {
    const today = new Date('2026-06-15T00:00:00Z');
    const bill = service.createBill({name: 'Overdue Test Bill', amount_cents: 1000, due_day: 5, match_pattern: ''});

    const results = service.getUpcomingBills(today);
    const entry = results.find((r) => r.bill.id === bill.id);
    assert.equal(entry?.status, 'overdue');
    assert.equal(entry?.dueDate, '2026-06-05');
});

test('getUpcomingBills marks a bill with a linked transaction this cycle as paid', async () => {
    const {TransactionService} = await import('./transactions.service.ts');
    const transactionService = new TransactionService();
    const today = new Date('2026-06-15T00:00:00Z');
    const bill = service.createBill({name: 'Paid Test Bill', amount_cents: 1000, due_day: 10, match_pattern: ''});
    transactionService.createTransaction({
        date: '2026-06-09', description: 'Paid Test Bill payment', amount_cents: -1000,
        category_id: null, bill_id: bill.id,
    });

    const results = service.getUpcomingBills(today);
    const entry = results.find((r) => r.bill.id === bill.id);
    assert.equal(entry?.status, 'paid');
});

test('getUpcomingBills omits a bill due more than 14 days out', () => {
    const today = new Date('2026-06-15T00:00:00Z');
    const bill = service.createBill({name: 'Far Future Test Bill', amount_cents: 1000, due_day: 30, match_pattern: ''});
    service.createBill({name: 'Dummy Spacer Bill For Far Future Test', amount_cents: 1, due_day: 1, match_pattern: ''});

    const results = service.getUpcomingBills(today);
    assert.equal(results.some((r) => r.bill.id === bill.id), false);
});

test('getUpcomingBills clamps due_day 31 to the last day of a shorter month', () => {
    const today = new Date('2026-02-20T00:00:00Z');
    const bill = service.createBill({name: 'Clamp Test Bill', amount_cents: 1000, due_day: 31, match_pattern: ''});

    const results = service.getUpcomingBills(today);
    const entry = results.find((r) => r.bill.id === bill.id);
    assert.equal(entry?.dueDate, '2026-02-28');
    assert.equal(entry?.status, 'upcoming');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test src/services/bill.service.test.ts`
Expected: FAIL — `service.getUpcomingBills is not a function`

- [ ] **Step 3: Implement `getUpcomingBills`**

In `backend/src/services/bill.service.ts`, add above the `BillService` class:

```ts
function lastDayOfMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function dueDateForMonth(year: number, month: number, dueDay: number): Date {
    const day = Math.min(dueDay, lastDayOfMonth(year, month));
    return new Date(Date.UTC(year, month, day));
}

function toISODate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

export type UpcomingBill = {
    bill: Bill;
    dueDate: string;
    status: 'paid' | 'overdue' | 'upcoming';
};
```

Then add this method inside the `BillService` class, after `findBillForDescription`:

```ts
    /**
     * Computes each bill's current-cycle due date and payment status.
     * A bill is only included when its due date is overdue (in the past
     * this cycle) or within the next 14 days — bills due further out are
     * omitted entirely. "Paid" means a transaction with this bill's id
     * falls within the window from the previous cycle's due date
     * (inclusive) up to the next cycle's due date (exclusive).
     *
     * @param today Reference date for "now" (defaults to the current time); only its UTC calendar date is used.
     * @return Upcoming/overdue/paid bills, sorted by due date ascending.
     */
    getUpcomingBills(today: Date = new Date()): UpcomingBill[] {
        const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
        const bills = this.getAllBills();
        const result: UpcomingBill[] = [];

        for (const bill of bills) {
            const dueDate = dueDateForMonth(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), bill.due_day);
            const prevDueDate = dueDateForMonth(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth() - 1, bill.due_day);
            const nextDueDate = dueDateForMonth(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth() + 1, bill.due_day);

            const daysUntilDue = Math.round((dueDate.getTime() - todayUTC.getTime()) / (24 * 60 * 60 * 1000));
            if (daysUntilDue > 14) {
                continue;
            }

            const paid = db.prepare(
                'SELECT 1 FROM transactions WHERE bill_id = ? AND date >= ? AND date < ? LIMIT 1'
            ).get(bill.id, toISODate(prevDueDate), toISODate(nextDueDate)) !== undefined;

            result.push({
                bill,
                dueDate: toISODate(dueDate),
                status: paid ? 'paid' : (daysUntilDue < 0 ? 'overdue' : 'upcoming'),
            });
        }

        return result.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test src/services/bill.service.test.ts`
Expected: PASS (16 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/bill.service.ts backend/src/services/bill.service.test.ts
git commit -m "Add BillService.getUpcomingBills"
```

---

### Task 4: `BillService.getSuggestedBills`

**Files:**
- Modify: `backend/src/services/bill.service.ts`
- Modify: `backend/src/services/bill.service.test.ts`

**Interfaces:**
- Consumes: `findBillForDescription` (same class, Task 2).
- Produces: `type SuggestedBill = {description: string, amount_cents: number, suggested_due_day: number, occurrences: number}`, `BillService.getSuggestedBills(): SuggestedBill[]`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/services/bill.service.test.ts`:

```ts
test('getSuggestedBills suggests a description seen 3+ times about a month apart', async () => {
    const {TransactionService} = await import('./transactions.service.ts');
    const transactionService = new TransactionService();
    const description = 'Suggest Me Monthly Charge';

    transactionService.createTransaction({
        date: '2026-04-01', description, amount_cents: -1500, category_id: null, bill_id: null,
    });
    transactionService.createTransaction({
        date: '2026-05-01', description, amount_cents: -1500, category_id: null, bill_id: null,
    });
    transactionService.createTransaction({
        date: '2026-06-02', description, amount_cents: -1500, category_id: null, bill_id: null,
    });

    const suggestions = service.getSuggestedBills();
    const suggestion = suggestions.find((s) => s.description === description);
    assert.ok(suggestion);
    assert.equal(suggestion?.amount_cents, -1500);
    assert.equal(suggestion?.occurrences, 3);
    assert.equal(suggestion?.suggested_due_day, 2);
});

test('getSuggestedBills does not suggest only 2 occurrences', async () => {
    const {TransactionService} = await import('./transactions.service.ts');
    const transactionService = new TransactionService();
    const description = 'Only Twice Charge';

    transactionService.createTransaction({
        date: '2026-04-01', description, amount_cents: -2000, category_id: null, bill_id: null,
    });
    transactionService.createTransaction({
        date: '2026-05-01', description, amount_cents: -2000, category_id: null, bill_id: null,
    });

    const suggestions = service.getSuggestedBills();
    assert.equal(suggestions.some((s) => s.description === description), false);
});

test('getSuggestedBills does not suggest occurrences spaced too close together', async () => {
    const {TransactionService} = await import('./transactions.service.ts');
    const transactionService = new TransactionService();
    const description = 'Frequent Coffee Purchase';

    transactionService.createTransaction({
        date: '2026-04-01', description, amount_cents: -500, category_id: null, bill_id: null,
    });
    transactionService.createTransaction({
        date: '2026-04-08', description, amount_cents: -500, category_id: null, bill_id: null,
    });
    transactionService.createTransaction({
        date: '2026-04-15', description, amount_cents: -500, category_id: null, bill_id: null,
    });

    const suggestions = service.getSuggestedBills();
    assert.equal(suggestions.some((s) => s.description === description), false);
});

test('getSuggestedBills excludes a description already matched by an existing bill', async () => {
    const {TransactionService} = await import('./transactions.service.ts');
    const transactionService = new TransactionService();
    const description = 'Already A Bill Charge';

    service.createBill({name: 'Already A Bill', amount_cents: 999, due_day: 1, match_pattern: 'Already A Bill Charge'});

    transactionService.createTransaction({
        date: '2026-04-01', description, amount_cents: -999, category_id: null, bill_id: null,
    });
    transactionService.createTransaction({
        date: '2026-05-01', description, amount_cents: -999, category_id: null, bill_id: null,
    });
    transactionService.createTransaction({
        date: '2026-06-01', description, amount_cents: -999, category_id: null, bill_id: null,
    });

    const suggestions = service.getSuggestedBills();
    assert.equal(suggestions.some((s) => s.description === description), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test src/services/bill.service.test.ts`
Expected: FAIL — `service.getSuggestedBills is not a function`

- [ ] **Step 3: Implement `getSuggestedBills`**

In `backend/src/services/bill.service.ts`, add this type near the other exported types (after `UpcomingBill`):

```ts
export type SuggestedBill = {
    description: string;
    amount_cents: number;
    suggested_due_day: number;
    occurrences: number;
};
```

Then add this method inside the `BillService` class, after `getUpcomingBills`:

```ts
    /**
     * Groups transactions with no linked bill by exact (description,
     * amount_cents), and suggests any group with 3 or more occurrences
     * whose consecutive dates are each 28-33 days apart (tolerates
     * weekend/month-length drift without catching unrelated repeat
     * purchases). Excludes any description already matched by an existing
     * bill's match_pattern.
     *
     * @return Candidate recurring bills, in no particular order.
     */
    getSuggestedBills(): SuggestedBill[] {
        const rows = db.prepare(
            `SELECT description, amount_cents, date FROM transactions
             WHERE bill_id IS NULL ORDER BY description, amount_cents, date`
        ).all() as {description: string, amount_cents: number, date: string}[];

        const groups = new Map<string, {description: string, amount_cents: number, dates: string[]}>();
        for (const row of rows) {
            const key = `${row.description} ${row.amount_cents}`;
            const group = groups.get(key);
            if (group) {
                group.dates.push(row.date);
            } else {
                groups.set(key, {description: row.description, amount_cents: row.amount_cents, dates: [row.date]});
            }
        }

        const suggestions: SuggestedBill[] = [];
        for (const group of groups.values()) {
            if (group.dates.length < 3) {
                continue;
            }
            if (this.findBillForDescription(group.description) !== null) {
                continue;
            }

            const sortedDates = [...group.dates].sort();
            const isMonthly = sortedDates.slice(1).every((date, i) => {
                const prev = new Date(`${sortedDates[i]}T00:00:00Z`).getTime();
                const curr = new Date(`${date}T00:00:00Z`).getTime();
                const gapDays = Math.round((curr - prev) / (24 * 60 * 60 * 1000));
                return gapDays >= 28 && gapDays <= 33;
            });
            if (!isMonthly) {
                continue;
            }

            const mostRecentDate = sortedDates[sortedDates.length - 1];
            suggestions.push({
                description: group.description,
                amount_cents: group.amount_cents,
                suggested_due_day: Number(mostRecentDate.slice(8, 10)),
                occurrences: sortedDates.length,
            });
        }

        return suggestions;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test src/services/bill.service.test.ts`
Expected: PASS (20 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/bill.service.ts backend/src/services/bill.service.test.ts
git commit -m "Add BillService.getSuggestedBills"
```

---

### Task 5: `bill.controller.ts`, `bill.router.ts`, mount in `app.ts`

**Files:**
- Create: `backend/src/controllers/bill.controller.ts`
- Create: `backend/src/routes/bill.router.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/routes/bills.test.ts`

**Interfaces:**
- Consumes: `validateBill` (Task 1), `BillService` (Tasks 2-4).
- Produces: `billsRouter` mounted at `/api/v1/bills`, exporting the standard CRUD endpoints plus `GET /bills/upcoming` and `GET /bills/suggestions`.

- [ ] **Step 1: Write the failing route tests**

Create `backend/src/routes/bills.test.ts`:

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

test('/api/v1/bills requires authentication', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/bills`);
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('creates a bill and returns it with an id', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/bills`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Netflix', amount_cents: 1599, due_day: 5, match_pattern: 'netflix'}),
        });
        assert.equal(res.status, 201);
        const body = await res.json();
        assert.ok(body.data.id);
        assert.equal(body.data.name, 'Netflix');
    } finally {
        await close();
    }
});

test('rejects a bill with an out-of-range due_day', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/bills`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Bad Bill', amount_cents: 1000, due_day: 0, match_pattern: ''}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('updates a bill', async () => {
    const {url, close} = await listen(app);
    try {
        const createRes = await fetch(`${url}/api/v1/bills`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Spotify', amount_cents: 1099, due_day: 10, match_pattern: 'spotify'}),
        });
        const {data: created} = await createRes.json();

        const updateRes = await fetch(`${url}/api/v1/bills/${created.id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Spotify Premium', amount_cents: 1199, due_day: 12, match_pattern: 'spotify'}),
        });
        assert.equal(updateRes.status, 200);
        const {data: updated} = await updateRes.json();
        assert.equal(updated.name, 'Spotify Premium');
    } finally {
        await close();
    }
});

test('deleting a bill 404s when it does not exist', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/bills/999999`, {
            method: 'DELETE',
            headers: {Cookie: cookie},
        });
        assert.equal(res.status, 404);
    } finally {
        await close();
    }
});

test('deletes a bill', async () => {
    const {url, close} = await listen(app);
    try {
        const createRes = await fetch(`${url}/api/v1/bills`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Temp Bill HTTP Test', amount_cents: 500, due_day: 1, match_pattern: ''}),
        });
        const {data: created} = await createRes.json();

        const deleteRes = await fetch(`${url}/api/v1/bills/${created.id}`, {
            method: 'DELETE',
            headers: {Cookie: cookie},
        });
        assert.equal(deleteRes.status, 204);
    } finally {
        await close();
    }
});

test('GET /bills/upcoming returns bills due soon or overdue', async () => {
    const {url, close} = await listen(app);
    try {
        await fetch(`${url}/api/v1/bills`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({name: 'Upcoming HTTP Test Bill', amount_cents: 1000, due_day: 1, match_pattern: ''}),
        });

        const res = await fetch(`${url}/api/v1/bills/upcoming`, {headers: {Cookie: cookie}});
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.ok(Array.isArray(body.data));
    } finally {
        await close();
    }
});

test('GET /bills/suggestions returns an array', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/bills/suggestions`, {headers: {Cookie: cookie}});
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.ok(Array.isArray(body.data));
    } finally {
        await close();
    }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test src/routes/bills.test.ts`
Expected: FAIL — cannot find module `../controllers/bill.controller.ts` (via `app.ts`, which doesn't reference it yet, so this will actually fail with a 404/401 mismatch instead — either way, no route exists yet)

- [ ] **Step 3: Implement `bill.controller.ts`**

Create `backend/src/controllers/bill.controller.ts`:

```ts
import type { Request, Response } from 'express';
import {validateBill} from "../helpers/billValidation.ts";
import {BillService} from "../services/bill.service.ts";

const billService = new BillService();

/**
 * Retrieves all bills from the database, ordered alphabetically by name,
 * and sends them in a JSON response.
 *
 * @param _req - The incoming request object. This parameter is not used.
 * @param res - The response object used to send the bill data.
 * @return The HTTP response containing the list of bills.
 */
export function getAllBills(_req: Request, res: Response) {
    const bills = billService.getAllBills();
    return res.status(200).json({data: bills});
}

/**
 * Retrieves a bill by its numeric identifier from the request parameters and sends the result as a JSON response.
 *
 * @param req Express request containing the bill id route parameter.
 * @param res Express response used to send validation errors, not found errors, or the bill data.
 * @return The HTTP response containing either an error message or the requested bill data.
 */
export function getBillById(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const bill = billService.getBillById(id);
    if (!bill) {
        return res.status(404).json({error: 'Bill not found'});
    }

    return res.status(200).json({data: bill});
}

/**
 * Creates a new bill from the request body after validating the submitted data.
 *
 * @param req Express request containing the bill data in the request body.
 * @param res Express response used to send the creation result or error response.
 * @return The Express response containing the created bill or an error response.
 */
export function createBill(req: Request, res: Response) {
    const result = validateBill(req.body);
    if (!result.ok) {
        return res.status(400).json({error: result.error});
    }

    const created = billService.createBill(result.value);
    return res.status(201).json({data: created});
}

/**
 * Updates an existing bill by its request parameter id using the validated request body.
 *
 * @param req Express request containing the bill id in the route parameters and updated bill data in the body.
 * @param res Express response used to return the updated bill or an error response.
 * @return A JSON response with the updated bill, a validation error, or a not found error.
 */
export function updateBill(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const result = validateBill(req.body);
    if (!result.ok) {
        return res.status(400).json({error: result.error});
    }

    const updated = billService.updateBill(id, result.value);
    if (!updated) {
        return res.status(404).json({error: 'Bill not found'});
    }
    return res.status(200).json({data: updated});
}

/**
 * Deletes a bill identified by the request route parameter.
 *
 * @param req Express request containing the bill id in the route parameters.
 * @param res Express response used to return the deletion result.
 * @return A response with status 204 when deleted, 400 when the id is invalid, or 404 when no bill is found.
 */
export function deleteBill(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const {changes} = billService.deleteBill(id);
    if (changes === 0) {
        return res.status(404).json({error: 'Bill not found'});
    }

    return res.status(204).end();
}

/**
 * Retrieves bills that are overdue or due within the next 14 days,
 * along with their payment status for the current cycle.
 *
 * @param _req - The incoming request object. This parameter is not used.
 * @param res - The response object used to send the upcoming-bills data.
 * @return The HTTP response containing the list of upcoming/overdue bills.
 */
export function getUpcomingBills(_req: Request, res: Response) {
    const upcoming = billService.getUpcomingBills();
    return res.status(200).json({data: upcoming});
}

/**
 * Retrieves candidate recurring bills detected from transaction history
 * that have not yet been set up as a bill.
 *
 * @param _req - The incoming request object. This parameter is not used.
 * @param res - The response object used to send the suggested-bills data.
 * @return The HTTP response containing the list of suggested bills.
 */
export function getSuggestedBills(_req: Request, res: Response) {
    const suggestions = billService.getSuggestedBills();
    return res.status(200).json({data: suggestions});
}
```

- [ ] **Step 4: Implement `bill.router.ts`**

Create `backend/src/routes/bill.router.ts`:

```ts
import express from "express";
import {
    createBill, deleteBill, getAllBills, getBillById, getSuggestedBills, getUpcomingBills, updateBill
} from "../controllers/bill.controller.ts";

export const billsRouter = express.Router()

billsRouter.get('/', getAllBills);
billsRouter.post('/', createBill);
billsRouter.get('/upcoming', getUpcomingBills);
billsRouter.get('/suggestions', getSuggestedBills);
billsRouter.get('/:id', getBillById);
billsRouter.put('/:id', updateBill);
billsRouter.delete('/:id', deleteBill);
```

- [ ] **Step 5: Mount `billsRouter` in `app.ts`**

In `backend/src/app.ts`, add the import next to the other router imports:

```ts
import {billsRouter} from './routes/bill.router.ts'
```

And add the mount line next to the other `app.use(...)` route mounts:

```ts
app.use('/api/v1/bills', requireAuth, billsRouter)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && node --test src/routes/bills.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 7: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: PASS (no regressions)

- [ ] **Step 8: Commit**

```bash
git add backend/src/controllers/bill.controller.ts backend/src/routes/bill.router.ts backend/src/routes/bills.test.ts backend/src/app.ts
git commit -m "Add bills CRUD routes plus /bills/upcoming and /bills/suggestions"
```

---

### Task 6: Auto-link transactions to bills on import and manual add

**Files:**
- Modify: `backend/src/controllers/transactionsImport.controller.ts`
- Modify: `backend/src/controllers/transactions.controller.ts`
- Modify: `backend/src/types/transaction.ts`
- Modify: `backend/src/routes/transactionSuggestCategory.test.ts`
- Test: `backend/src/routes/transactionsImport.test.ts` (new tests appended)

**Interfaces:**
- Consumes: `BillService.findBillForDescription` (Task 2).
- Produces: `ImportCandidate` now also carries `bill_id: number | null`; `POST /transactions/suggest-category` response now also carries `bill_id: number | null`.

- [ ] **Step 1: Write the failing tests**

In `backend/src/routes/transactionSuggestCategory.test.ts`, update the two existing `assert.deepEqual(body.data, {...})` calls to include `bill_id: null`:

```ts
        assert.deepEqual(body.data, {category_id: category.id, bill_id: null, aiSuggested: false, proposedCategoryName: null});
```

(apply this same `bill_id: null` addition to both occurrences in that file — the "resolves from exact-description history" test and the "falls back to a keyword rule" test).

Then append a new test to the same file:

```ts
test('auto-links to a bill by match_pattern when one matches', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);

        await fetch(`${url}/api/v1/bills`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({
                name: 'Netflix Suggest Test', amount_cents: 1599, due_day: 5, match_pattern: 'Netflix Suggest Test',
            }),
        });

        const res = await fetch(`${url}/api/v1/transactions/suggest-category`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({description: 'Netflix Suggest Test Monthly'}),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.notEqual(body.data.bill_id, null);
    } finally {
        await close();
    }
});
```

Append a new test to `backend/src/routes/transactionsImport.test.ts` (checking the pattern used by other tests in that file for uploading a PDF/invoking `previewImport`; if that file tests via multipart upload fixtures, instead add this equivalent test directly against `buildImportCandidates`'s effect by exercising `previewCsvImport`, which takes plain CSV text and needs no binary fixture):

```ts
test('previewCsvImport auto-links a candidate to a bill by match_pattern', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);

        await fetch(`${url}/api/v1/bills`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({
                name: 'CSV Import Bill Test', amount_cents: 1200, due_day: 1, match_pattern: 'CSV Import Bill Test',
            }),
        });

        const csv = 'Date,Description,Amount\n2026-06-01,CSV Import Bill Test Charge,-12.00\n';
        const form = new FormData();
        form.append('file', new Blob([csv], {type: 'text/csv'}), 'statement.csv');
        form.append('dateColumn', 'Date');
        form.append('descriptionColumn', 'Description');
        form.append('amountColumn', 'Amount');

        const res = await fetch(`${url}/api/v1/transactions/import/csv/preview`, {
            method: 'POST',
            headers: {Cookie: cookie},
            body: form,
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.notEqual(body.data.transactions[0].bill_id, null);
    } finally {
        await close();
    }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test src/routes/transactionSuggestCategory.test.ts src/routes/transactionsImport.test.ts`
Expected: FAIL — `bill_id` is `undefined`/missing in the responses, so the `deepEqual`/`notEqual` assertions fail.

- [ ] **Step 3: Add `bill_id` to `ImportCandidate` and wire the auto-link into import**

In `backend/src/types/transaction.ts`, find the `ImportCandidate` type definition (it currently extends `NewTransaction` with `isDuplicate`, `aiSuggested`, `proposedCategoryName` — check the file for its exact current shape before editing) and confirm it already includes `bill_id` via `NewTransaction` (it does, since `NewTransaction = Omit<Transaction, 'id'>` and `Transaction` already has `bill_id`). No change needed here — skip this type edit.

In `backend/src/controllers/transactionsImport.controller.ts`:

Add the import:

```ts
import {BillService} from '../services/bill.service.ts';
```

Add the instance next to `categoryRuleService`:

```ts
const billService = new BillService();
```

In `buildImportCandidates`, change the first `.map` to also set `bill_id`:

```ts
    const withRuleSuggestions = transactions.map((t) => ({
        ...t,
        category_id: transactionService.findRecentCategoryForDescription(t.description)
            ?? categoryRuleService.findCategoryForDescription(t.description),
        bill_id: billService.findBillForDescription(t.description),
        isDuplicate: transactionService.existsSimilar(t.date, t.description, t.amount_cents),
    }));
```

- [ ] **Step 4: Wire the auto-link into the manual-add suggestion endpoint**

In `backend/src/controllers/transactions.controller.ts`, add the import at the top:

```ts
import {BillService} from '../services/bill.service.ts';
```

Add the instance next to the other services at module scope (find where `categoryRuleService`/`transactionService` are instantiated in this file and add alongside):

```ts
const billService = new BillService();
```

In `suggestCategoryForDescription`, compute `bill_id` once at the top (right after the `description` check) and include it in every response object:

```ts
export async function suggestCategoryForDescription(req: Request, res: Response) {
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    if (description === '') {
        return res.status(400).json({error: 'description is required'});
    }

    const bill_id = billService.findBillForDescription(description);

    const category_id = transactionService.findRecentCategoryForDescription(description)
        ?? categoryRuleService.findCategoryForDescription(description);

    if (category_id !== null) {
        return res.status(200).json({data: {category_id, bill_id, aiSuggested: false, proposedCategoryName: null}});
    }

    const suggestions = await suggestCategories([description]);
    const suggestion = suggestions[description];

    if (!suggestion || suggestion.kind === 'none') {
        return res.status(200).json({data: {category_id: null, bill_id, aiSuggested: false, proposedCategoryName: null}});
    }

    if (suggestion.kind === 'existing') {
        return res.status(200).json({
            data: {category_id: suggestion.categoryId, bill_id, aiSuggested: true, proposedCategoryName: null},
        });
    }

    return res.status(200).json({
        data: {category_id: null, bill_id, aiSuggested: true, proposedCategoryName: suggestion.name},
    });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && node --test src/routes/transactionSuggestCategory.test.ts src/routes/transactionsImport.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: PASS (no regressions)

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/transactionsImport.controller.ts backend/src/controllers/transactions.controller.ts backend/src/routes/transactionSuggestCategory.test.ts backend/src/routes/transactionsImport.test.ts
git commit -m "Auto-link import and manual-add transactions to a matching bill"
```

---

### Task 7: Frontend `Bill` type and `BillApiService`

**Files:**
- Create: `frontend/src/types/bill.ts`
- Create: `frontend/src/services/BillApiService.ts`

**Interfaces:**
- Produces: `type Bill`, `type NewBill`, `type UpcomingBill`, `type SuggestedBill` (frontend mirrors of the backend types from Tasks 1, 3, 4); `class BillApiService` with `getAllBills`, `createBill`, `updateBill`, `deleteBill`, `getUpcomingBills`, `getSuggestedBills`; exported singleton `billApiService`.

- [ ] **Step 1: Create the frontend `Bill` types**

Create `frontend/src/types/bill.ts`:

```ts
export type Bill = {
    id: number;
    name: string;
    amount_cents: number;
    due_day: number;
    match_pattern: string;
}

export type NewBill = Omit<Bill, 'id'>;

export type UpcomingBill = {
    bill: Bill;
    dueDate: string;
    status: 'paid' | 'overdue' | 'upcoming';
};

export type SuggestedBill = {
    description: string;
    amount_cents: number;
    suggested_due_day: number;
    occurrences: number;
};
```

- [ ] **Step 2: Create `BillApiService`**

Create `frontend/src/services/BillApiService.ts`:

```ts
import {BaseApiService} from "./BaseApiService.ts";
import type {Bill, NewBill, SuggestedBill, UpcomingBill} from "../types/bill.ts";

export class BillApiService extends BaseApiService {

    constructor() {
        super('/bills');
    }

    getAllBills(): Promise<Bill[]> {
        return this.getAll<Bill[]>();
    }

    createBill(body: NewBill): Promise<Bill> {
        return this.create<Bill>(body);
    }

    updateBill(id: number, body: NewBill): Promise<Bill> {
        return this.update<Bill>(id, body);
    }

    deleteBill(id: number): Promise<void> {
        return this.delete(id);
    }

    getUpcomingBills(): Promise<UpcomingBill[]> {
        return this.getAll<UpcomingBill[]>({url: `${this.path}/upcoming`});
    }

    getSuggestedBills(): Promise<SuggestedBill[]> {
        return this.getAll<SuggestedBill[]>({url: `${this.path}/suggestions`});
    }
}

export const billApiService = new BillApiService();
```

Note: `getAll` in `BaseApiService` builds its request as `{...options, url: this.path}` — passing `url` inside `options` is overridden by the trailing `url: this.path` spread, so `getUpcomingBills`/`getSuggestedBills` must NOT reuse `getAll` with a URL override this way. Instead, call the protected `getById` helper, which does support a custom path segment:

Replace those two methods with:

```ts
    getUpcomingBills(): Promise<UpcomingBill[]> {
        return this.getById<UpcomingBill[]>('upcoming');
    }

    getSuggestedBills(): Promise<SuggestedBill[]> {
        return this.getById<SuggestedBill[]>('suggestions');
    }
```

(`getById` builds the URL as `${this.path}/${id}`, so `getById('upcoming')` hits `/bills/upcoming` — exactly the endpoint needed, despite the generic name.)

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/bill.ts frontend/src/services/BillApiService.ts
git commit -m "Add frontend Bill types and BillApiService"
```

---

### Task 8: `/bills` page

**Files:**
- Create: `frontend/src/bills/Bills.tsx`
- Create: `frontend/src/bills/Bills.css`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/Layout.tsx`

**Interfaces:**
- Consumes: `billApiService` (Task 7).
- Produces: `Bills` default export component, mounted at route `/bills`.

- [ ] **Step 1: Create `Bills.tsx`**

Create `frontend/src/bills/Bills.tsx`:

```tsx
import {useEffect, useState} from "react";
import {billApiService} from "../services/BillApiService.ts";
import type {Bill, SuggestedBill} from "../types/bill.ts";
import {formatMoney} from "../helpers/money.ts";
import "../styles/ledger.css"
import './Bills.css'

function Bills() {
    const [bills, setBills] = useState<Bill[]>();
    const [suggestions, setSuggestions] = useState<SuggestedBill[]>([]);
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const [newName, setNewName] = useState('');
    const [newAmount, setNewAmount] = useState('');
    const [newDueDay, setNewDueDay] = useState('1');
    const [newPattern, setNewPattern] = useState('');

    useEffect(() => {
        Promise.all([
            billApiService.getAllBills(),
            billApiService.getSuggestedBills(),
        ]).then(([b, s]) => {
            setBills(b);
            setSuggestions(s);
        }).catch((err) => {
            setError(err.message);
        }).finally(() => {
            setLoading(false);
        });
    }, []);

    function prefillFromSuggestion(suggestion: SuggestedBill) {
        setNewName(suggestion.description);
        setNewAmount((Math.abs(suggestion.amount_cents) / 100).toFixed(2));
        setNewDueDay(String(suggestion.suggested_due_day));
        setNewPattern(suggestion.description);
    }

    function dismissSuggestion(suggestion: SuggestedBill) {
        setDismissed((prev) => new Set(prev).add(`${suggestion.description} ${suggestion.amount_cents}`));
    }

    async function handleAdd() {
        const amountValue = Number(newAmount);
        const dueDayValue = Number(newDueDay);
        if (newName.trim() === '' || !Number.isFinite(amountValue) || amountValue <= 0) {
            return;
        }

        setError(null);
        try {
            const created = await billApiService.createBill({
                name: newName.trim(),
                amount_cents: Math.round(amountValue * 100),
                due_day: dueDayValue,
                match_pattern: newPattern.trim(),
            });
            setBills((prev) => [...(prev ?? []), created]);
            setNewName('');
            setNewAmount('');
            setNewDueDay('1');
            setNewPattern('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not create this bill');
        }
    }

    async function handleUpdate(bill: Bill, patch: Partial<Bill>) {
        setError(null);
        try {
            const updated = await billApiService.updateBill(bill.id, {
                name: patch.name ?? bill.name,
                amount_cents: patch.amount_cents ?? bill.amount_cents,
                due_day: patch.due_day ?? bill.due_day,
                match_pattern: patch.match_pattern ?? bill.match_pattern,
            });
            setBills((prev) => (prev ?? []).map((b) => b.id === bill.id ? updated : b));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not update this bill');
        }
    }

    async function handleDelete(id: number) {
        setError(null);
        try {
            await billApiService.deleteBill(id);
            setBills((prev) => (prev ?? []).filter((b) => b.id !== id));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete this bill');
        }
    }

    const visibleSuggestions = suggestions.filter(
        (s) => !dismissed.has(`${s.description} ${s.amount_cents}`)
    );

    return (
        <>
            <div className="bill-add">
                <input
                    type="text"
                    placeholder="Name (e.g. Netflix)"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                />
                <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                />
                <input
                    type="number"
                    min="1"
                    max="31"
                    placeholder="Due day"
                    value={newDueDay}
                    onChange={(e) => setNewDueDay(e.target.value)}
                />
                <input
                    type="text"
                    placeholder="Match pattern (optional)"
                    value={newPattern}
                    onChange={(e) => setNewPattern(e.target.value)}
                />
                <button type="button" onClick={handleAdd} disabled={newName.trim() === '' || newAmount.trim() === ''}>
                    Add bill
                </button>
            </div>

            {loading && <p className="ledger-status">Loading bills…</p>}
            {error && <p className="ledger-status error">{error}</p>}
            {!loading && !error && bills?.length === 0 && (
                <p className="ledger-status">No bills yet.</p>
            )}

            {!loading && !error && (bills ?? []).map((bill) => (
                <article className="ledger-row bill-row" key={bill.id}>
                    <input
                        type="text"
                        className="bill-name-input"
                        value={bill.name}
                        onChange={(e) => handleUpdate(bill, {name: e.target.value})}
                    />
                    <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="bill-amount-input"
                        value={(bill.amount_cents / 100).toFixed(2)}
                        onChange={(e) => {
                            const value = Number(e.target.value);
                            if (Number.isFinite(value) && value > 0) {
                                handleUpdate(bill, {amount_cents: Math.round(value * 100)});
                            }
                        }}
                    />
                    <input
                        type="number"
                        min="1"
                        max="31"
                        className="bill-due-day-input"
                        value={bill.due_day}
                        onChange={(e) => {
                            const value = Number(e.target.value);
                            if (Number.isInteger(value) && value >= 1 && value <= 31) {
                                handleUpdate(bill, {due_day: value});
                            }
                        }}
                    />
                    <input
                        type="text"
                        className="bill-pattern-input"
                        value={bill.match_pattern}
                        onChange={(e) => handleUpdate(bill, {match_pattern: e.target.value})}
                    />
                    <button type="button" onClick={() => handleDelete(bill.id)}>Delete</button>
                </article>
            ))}

            {visibleSuggestions.length > 0 && (
                <section className="bill-suggestions" aria-label="Suggested bills">
                    <h2 className="bill-suggestions__title">Suggested bills</h2>
                    {visibleSuggestions.map((suggestion) => (
                        <article
                            className="ledger-row bill-suggestion-row"
                            key={`${suggestion.description} ${suggestion.amount_cents}`}
                        >
                            <span className="bill-suggestion-description">{suggestion.description}</span>
                            <span className="bill-suggestion-amount">{formatMoney(suggestion.amount_cents)}</span>
                            <span className="bill-suggestion-occurrences">
                                {suggestion.occurrences} occurrences
                            </span>
                            <button type="button" onClick={() => prefillFromSuggestion(suggestion)}>
                                Add as bill
                            </button>
                            <button type="button" onClick={() => dismissSuggestion(suggestion)}>
                                Dismiss
                            </button>
                        </article>
                    ))}
                </section>
            )}
        </>
    )
}

export default Bills
```

- [ ] **Step 2: Create `Bills.css`**

Create `frontend/src/bills/Bills.css`:

```css
.bill-add {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.bill-add input {
  font-family: var(--sans);
  font-size: 0.9rem;
  color: var(--text-on-ink-strong);
  background: var(--ink-raised);
  border: 1px solid var(--rule-on-ink);
  border-radius: 4px;
  padding: 0.5rem 0.7rem;
}

.bill-add input[type="text"]:first-child {
  flex: 1;
  min-width: 10rem;
}

.bill-add button {
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

.bill-add button:hover {
  border-color: var(--text-on-ink);
}

.bill-add button:disabled {
  opacity: 0.5;
  cursor: default;
}

.bill-row {
  gap: 0.6rem;
}

.bill-row input {
  font-family: var(--sans);
  font-size: 0.85rem;
  color: var(--text-on-paper);
  background: var(--paper-dim);
  border: 1px solid var(--rule-on-paper);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
}

.bill-name-input {
  flex: 1;
}

.bill-amount-input {
  width: 6rem;
}

.bill-due-day-input {
  width: 4.5rem;
}

.bill-pattern-input {
  flex: 1;
}

.bill-row button {
  font-family: var(--sans);
  font-size: 0.85rem;
  color: var(--text-on-paper);
  background: none;
  border: 1px solid var(--rule-on-paper);
  border-radius: 4px;
  padding: 0.45rem 0.8rem;
  cursor: pointer;
}

.bill-suggestions {
  margin-top: 2rem;
}

.bill-suggestions__title {
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-on-paper);
  margin-bottom: 0.75rem;
}

.bill-suggestion-row {
  gap: 0.75rem;
}

.bill-suggestion-description {
  flex: 1;
}

.bill-suggestion-row button {
  font-family: var(--sans);
  font-size: 0.8rem;
  background: none;
  border: 1px solid var(--rule-on-paper);
  border-radius: 4px;
  padding: 0.4rem 0.7rem;
  cursor: pointer;
}

@media (max-width: 640px) {
  .bill-add {
    flex-wrap: wrap;
  }
}
```

- [ ] **Step 3: Add the `/bills` route**

In `frontend/src/main.tsx`, add the import:

```ts
import Bills from './bills/Bills.tsx'
```

And add the route next to `/rules`:

```tsx
              <Route path="/bills" element={<Bills/>}/>
```

- [ ] **Step 4: Add the nav link**

In `frontend/src/Layout.tsx`, add a `NavLink` next to the Rules link:

```tsx
                    <NavLink to="/bills" className={navClass}>Bills</NavLink>
```

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 6: Manual verification**

Run the dev servers (`cd backend && node --watch src/app.ts` and `cd frontend && npm run dev`), log in, navigate to `/bills`, add a bill, confirm it appears in the list and is editable/deletable inline.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/bills frontend/src/main.tsx frontend/src/Layout.tsx
git commit -m "Add /bills page with bill management and suggestions"
```

---

### Task 9: Bill selector on the transaction add/edit forms

**Files:**
- Modify: `frontend/src/types/transaction.ts`
- Modify: `frontend/src/services/TransactionApiService.ts`
- Modify: `frontend/src/transactions/AddTransactionForm.tsx`
- Modify: `frontend/src/transactions/EditTransactionRow.tsx`
- Modify: `frontend/src/transactions/Transactions.tsx`

**Interfaces:**
- Consumes: `billApiService` (Task 7).
- Produces: `CategorySuggestion` now also carries `bill_id: number | null`; `AddTransactionForm` and `EditTransactionRow` each gain a `bills: Bill[]` prop and a bill `<select>`.

- [ ] **Step 1: Add `bill_id` to `CategorySuggestion`**

In `frontend/src/types/transaction.ts`, update:

```ts
export type CategorySuggestion = {
    category_id: number | null;
    bill_id: number | null;
    aiSuggested: boolean;
    proposedCategoryName: string | null;
};
```

(The JSDoc above `suggestCategory` in `TransactionApiService.ts` already documents the shape loosely enough that no comment change is required there.)

- [ ] **Step 2: Fetch bills in `Transactions.tsx` and pass them down**

In `frontend/src/transactions/Transactions.tsx`, add the import:

```ts
import type {Bill} from "../types/bill.ts";
import {billApiService} from "../services/BillApiService.ts";
```

Add state and a fetch effect next to the existing `categories` state/effect:

```ts
    const [bills, setBills] = useState<Bill[]>([]);
```

```ts
    useEffect(() => {
        billApiService.getAllBills().then(setBills).catch(() => {});
    }, [])
```

Pass `bills={bills}` as a new prop to both `<AddTransactionForm ... />` and `<EditTransactionRow ... />` in the JSX below.

- [ ] **Step 3: Add the bill selector to `AddTransactionForm.tsx`**

In `frontend/src/transactions/AddTransactionForm.tsx`:

Add the import:

```ts
import type {Bill} from "../types/bill.ts";
```

Update the `Props` type to add `bills: Bill[];`.

Update the function signature to destructure `bills`:

```ts
function AddTransactionForm({categories, bills, onCreated, onCategoryCreated, onCancel}: Props) {
```

Add a `billId` state next to `categoryId`:

```ts
    const [billId, setBillId] = useState<number | null>(null);
```

In `handleDescriptionBlur`, set `billId` from the suggestion alongside the existing category fields:

```ts
    async function handleDescriptionBlur() {
        if (manuallySet || description.trim() === '') {
            return;
        }
        setSuggesting(true);
        try {
            const suggestion = await transactionApiService.suggestCategory(description.trim());
            setCategoryId(suggestion.category_id);
            setBillId(suggestion.bill_id);
            setAiSuggested(suggestion.aiSuggested);
            setProposedCategoryName(suggestion.proposedCategoryName);
        } catch {
            setCategoryId(null);
            setBillId(null);
            setAiSuggested(false);
            setProposedCategoryName(null);
        } finally {
            setSuggesting(false);
        }
    }
```

In `handleSubmit`, use `billId` instead of the hardcoded `null`:

```ts
            const newTransaction: NewTransaction = {
                date, description: description.trim(), amount_cents, category_id: finalCategoryId, bill_id: billId,
            };
```

Add a bill `<select>` next to the category select in the JSX, right after the category `<select>`/`NewCategoryBadge` block:

```tsx
                <select
                    className="ledger-category-select"
                    value={billId ?? ''}
                    onChange={(e) => setBillId(e.target.value === '' ? null : Number(e.target.value))}
                >
                    <option value="">No bill</option>
                    {bills.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                </select>
```

- [ ] **Step 4: Add the bill selector to `EditTransactionRow.tsx`**

In `frontend/src/transactions/EditTransactionRow.tsx`:

Add the import:

```ts
import type {Bill} from "../types/bill.ts";
```

Update `Props` to add `bills: Bill[];`.

Update the function signature:

```ts
function EditTransactionRow({transaction, categories, bills, onSaved, onDeleted, onCancel}: Props) {
```

Add a `billId` state next to `categoryId`:

```ts
    const [billId, setBillId] = useState<number | null>(transaction.bill_id);
```

In `handleSave`, replace the hardcoded `bill_id: transaction.bill_id` with `bill_id: billId`:

```ts
            const updated = await transactionApiService.updateTransaction(transaction.id, {
                date, description: description.trim(), amount_cents, category_id: categoryId, bill_id: billId,
            });
```

Add a bill `<select>` next to the category select in the JSX:

```tsx
                <select
                    className="ledger-category-select"
                    value={billId ?? ''}
                    onChange={(e) => setBillId(e.target.value === '' ? null : Number(e.target.value))}
                >
                    <option value="">No bill</option>
                    {bills.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                </select>
```

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors (this will surface any missed `bills` prop at either call site in `Transactions.tsx` if Step 2 was skipped)

- [ ] **Step 6: Manual verification**

In the running app, open `/transactions`, add a bill on `/bills` with a `match_pattern` matching an existing transaction description, then add a new transaction with that same description and confirm the bill selector auto-fills. Edit an existing transaction and confirm the bill selector shows "No bill" by default and can be changed and saved.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/transaction.ts frontend/src/transactions/AddTransactionForm.tsx frontend/src/transactions/EditTransactionRow.tsx frontend/src/transactions/Transactions.tsx
git commit -m "Add bill selector to transaction add/edit forms"
```

---

### Task 10: "Upcoming Bills" dashboard widget

**Files:**
- Create: `frontend/src/dashboard/UpcomingBills.tsx`
- Create: `frontend/src/dashboard/UpcomingBills.css`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `billApiService.getUpcomingBills()` (Task 7), `UpcomingBill` type (Task 7).
- Produces: `UpcomingBills` default export component, rendered in `App.tsx` independent of the existing range selector.

- [ ] **Step 1: Create `UpcomingBills.tsx`**

Create `frontend/src/dashboard/UpcomingBills.tsx`:

```tsx
import {useEffect, useState} from "react";
import {billApiService} from "../services/BillApiService.ts";
import type {UpcomingBill} from "../types/bill.ts";
import {formatMoney} from "../helpers/money.ts";
import './UpcomingBills.css'

function dueDateLabel(upcoming: UpcomingBill, today: Date): string {
    const due = new Date(`${upcoming.dueDate}T00:00:00Z`);
    const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const daysUntilDue = Math.round((due.getTime() - todayUTC.getTime()) / (24 * 60 * 60 * 1000));

    if (upcoming.status === 'overdue') {
        return `Overdue (was due ${upcoming.dueDate})`;
    }
    if (daysUntilDue === 0) {
        return 'Due today';
    }
    return `Due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`;
}

function UpcomingBills() {
    const [upcoming, setUpcoming] = useState<UpcomingBill[]>();
    const [error, setError] = useState<string | null>(null);
    const today = new Date();

    useEffect(() => {
        billApiService.getUpcomingBills().then(setUpcoming).catch((err) => {
            setError(err instanceof Error ? err.message : 'Could not load upcoming bills');
        });
    }, []);

    const unpaid = (upcoming ?? []).filter((u) => u.status !== 'paid');

    return (
        <article className="chart-card upcoming-bills-card" aria-label="Upcoming bills">
            <h3 className="chart-card__title">Upcoming Bills</h3>
            {error && <p className="ledger-status error">{error}</p>}
            {!error && upcoming !== undefined && unpaid.length === 0 && (
                <p className="upcoming-bills-empty">Nothing due soon.</p>
            )}
            {!error && unpaid.map((u) => (
                <div
                    key={u.bill.id}
                    className={`upcoming-bill-row ${u.status === 'overdue' ? 'upcoming-bill-row--overdue' : ''}`}
                >
                    <span className="upcoming-bill-name">{u.bill.name}</span>
                    <span className="upcoming-bill-amount">{formatMoney(u.bill.amount_cents)}</span>
                    <span className="upcoming-bill-due">{dueDateLabel(u, today)}</span>
                </div>
            ))}
        </article>
    );
}

export default UpcomingBills;
```

- [ ] **Step 2: Create `UpcomingBills.css`**

Create `frontend/src/dashboard/UpcomingBills.css`:

```css
.upcoming-bills-card {
  margin-bottom: 2rem;
}

.upcoming-bills-empty {
  font-family: var(--sans);
  font-size: 0.85rem;
  color: var(--text-on-ink);
}

.upcoming-bill-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--rule-on-ink);
  font-family: var(--sans);
  font-size: 0.85rem;
  color: var(--text-on-ink-strong);
}

.upcoming-bill-row:last-child {
  border-bottom: none;
}

.upcoming-bill-name {
  flex: 1;
}

.upcoming-bill-amount {
  font-variant-numeric: tabular-nums oldstyle-nums;
}

.upcoming-bill-due {
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--text-on-ink);
}

.upcoming-bill-row--overdue .upcoming-bill-due {
  color: var(--debit);
}
```

- [ ] **Step 3: Render the widget in `App.tsx`**

In `frontend/src/App.tsx`, add the import:

```ts
import UpcomingBills from "./dashboard/UpcomingBills.tsx";
```

Render it right after the `<RangeSelect .../>` line and before the `<section className="chart-grid" ...>` block, so it's visually separated from the range-filtered charts below it:

```tsx
                <RangeSelect value={range} onChange={setRange}/>
                <UpcomingBills/>
                <section className="chart-grid" aria-label="Financial charts">
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors

- [ ] **Step 5: Manual verification**

In the running app, create a bill due today or within the next 14 days (and one with a `due_day` already past this month with no linked transaction), navigate to `/dashboard`, and confirm the Upcoming Bills card shows both, with the overdue one visually flagged. Link a transaction to one of the bills (via the transaction edit bill selector) and confirm it drops off the widget.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/dashboard/UpcomingBills.tsx frontend/src/dashboard/UpcomingBills.css frontend/src/App.tsx
git commit -m "Add Upcoming Bills dashboard widget"
```
