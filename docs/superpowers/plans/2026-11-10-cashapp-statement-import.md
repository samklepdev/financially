# Cash App Statement Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user upload a Cash App monthly PDF statement and import its transactions into the ledger, with duplicate flagging and a confirm step before anything is written to the database.

**Architecture:** Position-based PDF text extraction (`pdfjs-dist`) reconstructs the statement's table from each text item's (x, y) coordinates, since plain-text extraction doesn't preserve visual row/column order. Two pure helper modules (row reconstruction, then Cash-App-specific field mapping) do all the parsing logic and are fully unit-tested; a thin glue service wires them to the real PDF library. Two backend endpoints — preview (parse only) and confirm (validate + insert) — keep parsing side-effect-free. The frontend gets a new `/import` page: upload, review a checkbox-per-row preview, confirm.

**Tech Stack:** Express 5, `node:sqlite`, `node:test`, new deps `pdfjs-dist` + `multer` (+ `@types/multer`) on the backend. React 19, react-router-dom 7, axios on the frontend — no new frontend dependencies.

## Global Constraints

- Plain SQL with `?` placeholders, no ORM (existing convention).
- API response shape: success `{ data }`, failure `{ error }` (existing convention — see `backend/src/controllers/transactions.controller.ts`).
- `category_id`/`bill_id` are always `null` on import — there's no categories/bills CRUD yet.
- Imported amounts fold the Fee column into `amount_cents`: `amount_cents = round((signedAmount - fee) * 100)`, where a `+` prefix on Amount means credit, no prefix means debit, and fee is always a positive cost.
- Description is `"<Description> (<Details>)"` — one field, no schema change.
- Duplicate detection (`date`, `description`, `amount_cents` match an existing row) is informational only — it flags, never silently drops, a candidate row.
- Rows whose Details contains `"(canceled)"` are skipped entirely (zero financial effect).
- All `/api/v1/transactions/*` routes stay behind the existing `requireAuth` middleware.
- No column-mapping UI — this targets one known, fixed Cash App statement layout, not arbitrary files.
- Backend runs TypeScript directly via Node 26 (`node --watch src/app.ts`) — no build step, no `tsx`/`ts-node`. `tsc --noEmit` is used only for type-checking, never for emitting the code that actually runs.

---

### Task 1: Statement row reconstruction (pure, position-based)

**Files:**
- Create: `backend/src/helpers/statementRows.ts`
- Test: `backend/src/helpers/statementRows.test.ts`

**Interfaces:**
- Produces: `type TextItem = {text: string, x: number, y: number}`, `type ColumnName = 'date' | 'description' | 'details' | 'fee' | 'amount'`, `type ColumnBounds = Record<ColumnName, number>`, `type BucketedRow = Record<ColumnName, string>`, `groupIntoRows(items: TextItem[]): TextItem[][]`, `findHeaderRowIndex(rows: TextItem[][]): number`, `columnBoundsFromRow(row: TextItem[]): ColumnBounds`, `bucketRow(items: TextItem[], bounds: ColumnBounds): BucketedRow`, `isNoiseRow(row: BucketedRow): boolean`, `isContinuationRow(row: BucketedRow): boolean`, `mergeContinuations(rows: BucketedRow[]): BucketedRow[]`.

This module assumes `y` increases top-to-bottom and that items are already
non-empty/non-whitespace-only — the PDF-extraction glue layer (Task 4) is
responsible for that normalization, since it depends on `pdfjs-dist`'s
coordinate space (which increases bottom-to-top) and filters stray
empty-string artifacts pdfjs sometimes emits at the same position as real
text.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/helpers/statementRows.test.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
    groupIntoRows,
    findHeaderRowIndex,
    columnBoundsFromRow,
    bucketRow,
    isNoiseRow,
    isContinuationRow,
    mergeContinuations,
    type TextItem,
    type BucketedRow,
} from './statementRows.ts';

const HEADER: TextItem[] = [
    {text: 'Date', x: 56, y: 100},
    {text: 'Description', x: 98, y: 100},
    {text: 'Details', x: 300, y: 100},
    {text: 'Fee', x: 458, y: 100},
    {text: 'Amount', x: 512, y: 100},
];

test('groupIntoRows clusters items by close y and sorts rows top to bottom', () => {
    const items: TextItem[] = [
        {text: 'B', x: 0, y: 140},
        {text: 'A', x: 0, y: 100},
        {text: 'A2', x: 10, y: 101},
    ];
    const rows = groupIntoRows(items);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].map((i) => i.text), ['A', 'A2']);
    assert.deepEqual(rows[1].map((i) => i.text), ['B']);
});

test('findHeaderRowIndex finds the row containing all five header labels', () => {
    const rows = [[{text: 'Transactions', x: 56, y: 60}], HEADER, [{text: 'Sep 5', x: 56, y: 140}]];
    assert.equal(findHeaderRowIndex(rows), 1);
});

test('findHeaderRowIndex returns -1 when no header row is present', () => {
    assert.equal(findHeaderRowIndex([[{text: 'nope', x: 0, y: 0}]]), -1);
});

test('columnBoundsFromRow reads each label\'s x position', () => {
    const bounds = columnBoundsFromRow(HEADER);
    assert.deepEqual(bounds, {date: 56, description: 98, details: 300, fee: 458, amount: 512});
});

test('bucketRow assigns items using midpoint boundaries, not raw header x', () => {
    // Real Cash App data: Fee/Amount values are right-aligned and sit to the
    // LEFT of their own header label's x position, so a naive "x >= header x"
    // rule would misbucket them. Midpoints between adjacent headers fix this.
    const bounds = columnBoundsFromRow(HEADER);
    const row: TextItem[] = [
        {text: 'Sep 5', x: 56, y: 140},
        {text: 'Walmart Houston TX', x: 98, y: 140},
        {text: 'Paper money deposit', x: 300, y: 140},
        {text: '$1.00', x: 450, y: 140}, // left of the Fee header's own x (458)
        {text: '+ $100.00', x: 503, y: 140}, // left of the Amount header's own x (512)
    ];
    const bucketed = bucketRow(row, bounds);
    assert.deepEqual(bucketed, {
        date: 'Sep 5',
        description: 'Walmart Houston TX',
        details: 'Paper money deposit',
        fee: '$1.00',
        amount: '+ $100.00',
    });
});

test('isNoiseRow is true only when date, description, and details are all empty', () => {
    const noise: BucketedRow = {date: '', description: '', details: '', fee: '', amount: '2 / 15'};
    const real: BucketedRow = {date: '', description: 'x8703', details: '', fee: '', amount: ''};
    assert.equal(isNoiseRow(noise), true);
    assert.equal(isNoiseRow(real), false);
});

test('isContinuationRow is true when date, fee, and amount are all empty', () => {
    const continuation: BucketedRow = {date: '', description: 'x8703', details: '', fee: '', amount: ''};
    const normal: BucketedRow = {date: 'Sep 5', description: 'A', details: 'B', fee: '$0.00', amount: '$1.00'};
    assert.equal(isContinuationRow(continuation), true);
    assert.equal(isContinuationRow(normal), false);
});

test('mergeContinuations appends a continuation row\'s text onto the previous row', () => {
    const rows: BucketedRow[] = [
        {date: 'Sep 7', description: 'From Stride Bank, National Association', details: 'Standard transfer', fee: '$0.00', amount: '+ $57.00'},
        {date: '', description: 'x8703', details: '', fee: '', amount: ''},
    ];
    const merged = mergeContinuations(rows);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].description, 'From Stride Bank, National Association x8703');
});

test('mergeContinuations drops a leading continuation-shaped row with nothing before it', () => {
    const rows: BucketedRow[] = [{date: '', description: 'stray', details: '', fee: '', amount: ''}];
    assert.deepEqual(mergeContinuations(rows), [{date: '', description: 'stray', details: '', fee: '', amount: ''}]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/helpers/statementRows.test.ts`
Expected: FAIL — `statementRows.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/helpers/statementRows.ts

export type TextItem = {text: string, x: number, y: number};
export type ColumnName = 'date' | 'description' | 'details' | 'fee' | 'amount';
export type ColumnBounds = Record<ColumnName, number>;
export type BucketedRow = Record<ColumnName, string>;

const ROW_TOLERANCE = 3;

const HEADER_LABELS: Record<ColumnName, string> = {
    date: 'Date',
    description: 'Description',
    details: 'Details',
    fee: 'Fee',
    amount: 'Amount',
};

/**
 * Groups text items into visual rows by y-position. Assumes y increases
 * top-to-bottom. Items within ROW_TOLERANCE of a row's first item's y are
 * treated as the same row (compared to the row's first item, not the last
 * one added, to avoid cumulative drift across a wide row).
 */
export function groupIntoRows(items: TextItem[]): TextItem[][] {
    const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
    const rows: TextItem[][] = [];

    for (const item of sorted) {
        const lastRow = rows.at(-1);
        const rowY = lastRow?.[0]?.y;
        if (lastRow && rowY !== undefined && Math.abs(item.y - rowY) <= ROW_TOLERANCE) {
            lastRow.push(item);
        } else {
            rows.push([item]);
        }
    }

    return rows;
}

/**
 * Finds the row that contains all five column header labels.
 *
 * @return The row's index, or -1 if no such row exists.
 */
export function findHeaderRowIndex(rows: TextItem[][]): number {
    const labels = Object.values(HEADER_LABELS);
    return rows.findIndex((row) => {
        const texts = new Set(row.map((item) => item.text));
        return labels.every((label) => texts.has(label));
    });
}

/**
 * Reads each column's x-position from the header row.
 *
 * @throws Error if the row is missing one of the expected labels.
 */
export function columnBoundsFromRow(row: TextItem[]): ColumnBounds {
    const byText = new Map(row.map((item) => [item.text, item.x]));
    const bounds = {} as ColumnBounds;

    for (const [column, label] of Object.entries(HEADER_LABELS) as [ColumnName, string][]) {
        const x = byText.get(label);
        if (x === undefined) {
            throw new Error(`Header row is missing the "${label}" column`);
        }
        bounds[column] = x;
    }

    return bounds;
}

/**
 * Column boundaries as midpoints between adjacent header x-positions, not
 * the header positions themselves: Fee/Amount are right-aligned numeric
 * columns whose values sit to the left of their own header label, so using
 * the header's own x as a lower bound would misbucket them.
 */
function columnStarts(bounds: ColumnBounds): {name: ColumnName, start: number}[] {
    const entries = (Object.entries(bounds) as [ColumnName, number][]).sort((a, b) => a[1] - b[1]);
    const starts: {name: ColumnName, start: number}[] = [{name: entries[0][0], start: -Infinity}];

    for (let i = 1; i < entries.length; i++) {
        const midpoint = (entries[i - 1][1] + entries[i][1]) / 2;
        starts.push({name: entries[i][0], start: midpoint});
    }

    return starts;
}

function columnFor(x: number, bounds: ColumnBounds): ColumnName {
    const starts = columnStarts(bounds);
    let column = starts[0].name;

    for (const entry of starts) {
        if (x >= entry.start) {
            column = entry.name;
        }
    }

    return column;
}

/**
 * Buckets a row's text items into columns by x-position, using midpoint
 * boundaries derived from the header row.
 */
export function bucketRow(items: TextItem[], bounds: ColumnBounds): BucketedRow {
    const buckets: Record<ColumnName, string[]> = {date: [], description: [], details: [], fee: [], amount: []};

    for (const item of [...items].sort((a, b) => a.x - b.x)) {
        buckets[columnFor(item.x, bounds)].push(item.text);
    }

    const row = {} as BucketedRow;
    for (const column of Object.keys(buckets) as ColumnName[]) {
        row[column] = buckets[column].join(' ').replace(/\s+/g, ' ').trim();
    }

    return row;
}

/**
 * A row with nothing in date, description, or details — page furniture like
 * a page-number footer, not real table content.
 */
export function isNoiseRow(row: BucketedRow): boolean {
    return row.date === '' && row.description === '' && row.details === '';
}

/**
 * A row with no date, fee, or amount — a wrapped second line of a long
 * Description or Details value, to be merged into the previous row.
 */
export function isContinuationRow(row: BucketedRow): boolean {
    return row.date === '' && row.fee === '' && row.amount === '';
}

/**
 * Merges each continuation row's description/details into the previous row.
 * A continuation-shaped row with nothing before it (merged is still empty)
 * is kept as its own row rather than dropped.
 */
export function mergeContinuations(rows: BucketedRow[]): BucketedRow[] {
    const merged: BucketedRow[] = [];

    for (const row of rows) {
        if (isContinuationRow(row) && merged.length > 0) {
            const previous = merged.at(-1)!;
            previous.description = [previous.description, row.description].filter(Boolean).join(' ');
            previous.details = [previous.details, row.details].filter(Boolean).join(' ');
        } else {
            merged.push({...row});
        }
    }

    return merged;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/helpers/statementRows.test.ts`
Expected: PASS (9 tests passing)

- [ ] **Step 5: Commit**

```bash
git add backend/src/helpers/statementRows.ts backend/src/helpers/statementRows.test.ts
git commit -m "Add position-based statement row reconstruction"
```

---

### Task 2: Cash App field mapping (pure)

**Files:**
- Create: `backend/src/helpers/cashAppMapping.ts`
- Test: `backend/src/helpers/cashAppMapping.test.ts`

**Interfaces:**
- Consumes: `type BucketedRow` from `./statementRows.ts`, `type NewTransaction` from `../types/transaction.ts`.
- Produces: `reconstructDate(monthYear: string, shortDate: string): string`, `computeAmountCents(amountText: string, feeText: string): number`, `buildDescription(description: string, details: string): string`, `isCanceled(details: string): boolean`, `mapRowToTransaction(monthYear: string, row: BucketedRow): NewTransaction | null`.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/helpers/cashAppMapping.test.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
    reconstructDate,
    computeAmountCents,
    buildDescription,
    isCanceled,
    mapRowToTransaction,
} from './cashAppMapping.ts';
import type {BucketedRow} from './statementRows.ts';

test('reconstructDate combines the page month/year with the row\'s short date', () => {
    assert.equal(reconstructDate('September 2026', 'Sep 5'), '2026-09-05');
    assert.equal(reconstructDate('September 2026', 'Sep 27'), '2026-09-27');
});

test('reconstructDate throws when the row date doesn\'t match the statement month', () => {
    assert.throws(() => reconstructDate('September 2026', 'Oct 1'));
});

test('computeAmountCents folds a fee into a credit', () => {
    // Walmart deposit: +$100.00, $1.00 fee -> net +$99.00
    assert.equal(computeAmountCents('+ $100.00', '$1.00'), 9900);
});

test('computeAmountCents folds a fee into a debit', () => {
    // Visa instant transfer: $16.88, $0.50 fee -> net -$17.38
    assert.equal(computeAmountCents('$16.88', '$0.50'), -1738);
});

test('computeAmountCents handles a zero fee', () => {
    assert.equal(computeAmountCents('$10.00', '$0.00'), -1000);
    assert.equal(computeAmountCents('+ $10.00', '$0.00'), 1000);
});

test('buildDescription combines Description and Details', () => {
    assert.equal(
        buildDescription('From Stride Bank, National Association x8703', 'Standard transfer'),
        'From Stride Bank, National Association x8703 (Standard transfer)'
    );
});

test('isCanceled detects a canceled transaction\'s Details text', () => {
    assert.equal(isCanceled('Cash App Pay (canceled)'), true);
    assert.equal(isCanceled('Cash App Card'), false);
});

test('mapRowToTransaction returns null for a canceled row', () => {
    const row: BucketedRow = {
        date: 'Sep 27', description: 'Google', details: 'Cash App Pay (canceled)', fee: '$0.00', amount: '$0.00',
    };
    assert.equal(mapRowToTransaction('September 2026', row), null);
});

test('mapRowToTransaction maps a normal row to a NewTransaction', () => {
    const row: BucketedRow = {
        date: 'Sep 5', description: 'Walmart Houston TX', details: 'Paper money deposit', fee: '$1.00', amount: '+ $100.00',
    };
    assert.deepEqual(mapRowToTransaction('September 2026', row), {
        date: '2026-09-05',
        description: 'Walmart Houston TX (Paper money deposit)',
        amount_cents: 9900,
        category_id: null,
        bill_id: null,
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/helpers/cashAppMapping.test.ts`
Expected: FAIL — `cashAppMapping.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/helpers/cashAppMapping.ts
import type {BucketedRow} from './statementRows.ts';
import type {NewTransaction} from '../types/transaction.ts';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_MONTHS = MONTH_NAMES.map((m) => m.slice(0, 3));

/**
 * Combines a page's "September 2026" header with a row's "Sep 5" date.
 *
 * @throws Error if either string can't be parsed, or the row's month doesn't
 * match the statement's month.
 */
export function reconstructDate(monthYear: string, shortDate: string): string {
    const monthYearMatch = monthYear.match(/^(\w+)\s+(\d{4})$/);
    if (!monthYearMatch) {
        throw new Error(`Could not parse statement month/year: "${monthYear}"`);
    }
    const [, monthName, year] = monthYearMatch;
    const monthIndex = MONTH_NAMES.indexOf(monthName);
    if (monthIndex === -1) {
        throw new Error(`Unknown month name: "${monthName}"`);
    }

    const dateMatch = shortDate.match(/^(\w{3})\s+(\d{1,2})$/);
    if (!dateMatch) {
        throw new Error(`Could not parse row date: "${shortDate}"`);
    }
    const [, shortMonth, day] = dateMatch;
    if (SHORT_MONTHS[monthIndex] !== shortMonth) {
        throw new Error(`Row date "${shortDate}" doesn't match statement month "${monthYear}"`);
    }

    return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function parseDollars(text: string): number {
    return Number(text.replace(/[^0-9.]/g, ''));
}

/**
 * Folds a row's Fee into its signed Amount.
 *
 * @param amountText e.g. "+ $100.00" (credit) or "$16.88" (debit, no sign).
 * @param feeText e.g. "$1.00". Always a positive cost.
 * @return amount_cents = round((signedAmount - fee) * 100).
 */
export function computeAmountCents(amountText: string, feeText: string): number {
    const isCredit = amountText.trim().startsWith('+');
    const amount = parseDollars(amountText);
    const fee = parseDollars(feeText || '$0.00');
    const signedAmount = isCredit ? amount : -amount;
    return Math.round((signedAmount - fee) * 100);
}

/**
 * Combines the Description and Details columns into one field.
 */
export function buildDescription(description: string, details: string): string {
    return details ? `${description} (${details})` : description;
}

/**
 * A canceled transaction has zero real financial effect.
 */
export function isCanceled(details: string): boolean {
    return details.includes('(canceled)');
}

/**
 * Maps one reconstructed statement row to a transaction ready to insert.
 *
 * @return null if the row is a canceled transaction (should be skipped).
 */
export function mapRowToTransaction(monthYear: string, row: BucketedRow): NewTransaction | null {
    if (isCanceled(row.details)) {
        return null;
    }

    return {
        date: reconstructDate(monthYear, row.date),
        description: buildDescription(row.description, row.details),
        amount_cents: computeAmountCents(row.amount, row.fee),
        category_id: null,
        bill_id: null,
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/helpers/cashAppMapping.test.ts`
Expected: PASS (9 tests passing)

- [ ] **Step 5: Commit**

```bash
git add backend/src/helpers/cashAppMapping.ts backend/src/helpers/cashAppMapping.test.ts
git commit -m "Add Cash App field mapping (date, fee folding, description, canceled rows)"
```

---

### Task 3: TransactionService — duplicate check and bulk insert

**Files:**
- Modify: `backend/src/services/transactions.service.ts`
- Test: `backend/src/services/transactions.service.test.ts`

**Interfaces:**
- Produces (added to the existing `TransactionService` class): `existsSimilar(date: string, description: string, amount_cents: number): boolean`, `createMany(transactions: NewTransaction[]): Transaction[]`.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/services/transactions.service.test.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_FILE = ':memory:';
const {TransactionService} = await import('./transactions.service.ts');

const service = new TransactionService();

test('existsSimilar returns false when nothing matches', () => {
    assert.equal(service.existsSimilar('2026-09-05', 'Walmart Houston TX', 9900), false);
});

test('existsSimilar returns true after a matching transaction is created', () => {
    service.createMany([
        {date: '2026-09-05', description: 'Walmart Houston TX', amount_cents: 9900, category_id: null, bill_id: null},
    ]);
    assert.equal(service.existsSimilar('2026-09-05', 'Walmart Houston TX', 9900), true);
});

test('createMany inserts every transaction and returns them with ids', () => {
    const created = service.createMany([
        {date: '2026-09-06', description: 'A', amount_cents: 100, category_id: null, bill_id: null},
        {date: '2026-09-06', description: 'B', amount_cents: -200, category_id: null, bill_id: null},
    ]);
    assert.equal(created.length, 2);
    assert.ok(created[0].id);
    assert.ok(created[1].id);
});

test('createMany rolls back entirely if one insert fails', () => {
    assert.throws(() => {
        service.createMany([
            {date: '2026-09-07', description: 'Good row', amount_cents: 100, category_id: null, bill_id: null},
            {date: '2026-09-07', description: 'Bad row', amount_cents: 200, category_id: 9999, bill_id: null},
        ]);
    });
    assert.equal(service.existsSimilar('2026-09-07', 'Good row', 100), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/services/transactions.service.test.ts`
Expected: FAIL — `existsSimilar is not a function`.

- [ ] **Step 3: Add the two methods**

Add to the `TransactionService` class in `backend/src/services/transactions.service.ts` (after `deleteTransaction`, before the closing `}`):

```typescript
    /**
     * Checks whether a transaction with the same date, description, and
     * amount already exists. Used to flag (not block) likely duplicates
     * during import — two transactions can legitimately share all three.
     */
    existsSimilar(date: string, description: string, amount_cents: number): boolean {
        const row = db.prepare(
            'SELECT 1 FROM transactions WHERE date = ? AND description = ? AND amount_cents = ? LIMIT 1'
        ).get(date, description, amount_cents);
        return row !== undefined;
    }

    /**
     * Inserts every transaction in one all-or-nothing database transaction.
     *
     * @throws Error (and rolls back every insert in this batch) if any row fails,
     * e.g. a foreign key violation on category_id/bill_id.
     */
    createMany(transactions: NewTransaction[]): Transaction[] {
        const insert = db.prepare(`INSERT INTO transactions (date, description, amount_cents, category_id, bill_id)
            VALUES (?, ?, ?, ?, ?) RETURNING *`);
        const created: Transaction[] = [];

        db.exec('BEGIN');
        try {
            for (const t of transactions) {
                created.push(insert.get(t.date, t.description, t.amount_cents, t.category_id, t.bill_id) as Transaction);
            }
            db.exec('COMMIT');
        } catch (err) {
            db.exec('ROLLBACK');
            throw err;
        }

        return created;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/services/transactions.service.test.ts`
Expected: PASS (4 tests passing)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/transactions.service.ts backend/src/services/transactions.service.test.ts
git commit -m "Add duplicate check and all-or-nothing bulk insert to TransactionService"
```

---

### Task 4: PDF extraction glue (pdfjs-dist)

**Files:**
- Modify: `backend/package.json` (add `pdfjs-dist` dependency)
- Create: `backend/src/services/cashAppStatementParser.ts`

**Interfaces:**
- Consumes: everything from `../helpers/statementRows.ts` (Task 1) and `../helpers/cashAppMapping.ts` (Task 2).
- Produces: `parseCashAppStatementPdf(buffer: Buffer): Promise<NewTransaction[]>`.

No automated test for this task — it's the integration point with the real
`pdfjs-dist` library and a real PDF's internal structure, which the project's
testing approach (per the design spec) verifies manually against a real
statement rather than with synthetic fixtures. Tasks 1 and 2 already cover
all the actual logic with full unit tests; this task is the thin, verified-
by-hand wiring between them and the library.

- [ ] **Step 1: Install pdfjs-dist**

```bash
cd backend && npm install pdfjs-dist
```

- [ ] **Step 2: Write the parser**

```typescript
// backend/src/services/cashAppStatementParser.ts
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
    groupIntoRows,
    findHeaderRowIndex,
    columnBoundsFromRow,
    bucketRow,
    isNoiseRow,
    mergeContinuations,
    type TextItem,
} from '../helpers/statementRows.ts';
import {mapRowToTransaction} from '../helpers/cashAppMapping.ts';
import type {NewTransaction} from '../types/transaction.ts';

const MONTH_YEAR = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/;

/**
 * Parses a Cash App monthly PDF account statement into candidate transactions.
 * Scans every page; a page with no transaction table (e.g. the summary or
 * legal-text pages) is silently skipped.
 *
 * @throws Error if no page in the whole document has a recognizable statement table.
 */
export async function parseCashAppStatementPdf(buffer: Buffer): Promise<NewTransaction[]> {
    // pdfjs-dist rejects a raw Node Buffer — it must be a plain Uint8Array.
    const doc = await getDocument({data: new Uint8Array(buffer)}).promise;
    const transactions: NewTransaction[] = [];

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
        const page = await doc.getPage(pageNum);
        const content = await page.getTextContent();
        const viewport = page.getViewport({scale: 1});

        const items: TextItem[] = (content.items as {str: string, transform: number[]}[])
            .map((item) => ({
                text: item.str,
                x: item.transform[4],
                // pdfjs's y increases bottom-to-top; flip it so our row
                // reconstruction's "increases top-to-bottom" assumption holds.
                y: viewport.height - item.transform[5],
            }))
            .filter((item) => item.text.trim() !== '');

        const monthYearMatch = items.map((item) => item.text.match(MONTH_YEAR)).find((m) => m);
        const rows = groupIntoRows(items);
        const headerIndex = findHeaderRowIndex(rows);

        if (!monthYearMatch || headerIndex === -1) {
            continue;
        }

        const bounds = columnBoundsFromRow(rows[headerIndex]);
        const dataRows = rows.slice(headerIndex + 1)
            .map((row) => bucketRow(row, bounds))
            .filter((row) => !isNoiseRow(row));
        const merged = mergeContinuations(dataRows);

        for (const row of merged) {
            const mapped = mapRowToTransaction(monthYearMatch[0], row);
            if (mapped) {
                transactions.push(mapped);
            }
        }
    }

    if (transactions.length === 0) {
        throw new Error('Could not find the expected statement layout in this PDF');
    }

    return transactions;
}
```

- [ ] **Step 3: Type-check**

Run: `cd backend && npx tsc --noEmit`

`pdfjs-dist`'s deep subpath import (`pdfjs-dist/legacy/build/pdf.mjs`) may or
may not resolve cleanly under this project's `"module": "nodenext"` setting.
If `tsc` complains here, it's fine — this project has `"noEmit": true` and
runs TypeScript directly via `node`, not via a `tsc` build step, so a
type-checking complaint about this import doesn't affect runtime behavior
(already verified against a real statement PDF while writing this plan). Add
a `// @ts-expect-error pdfjs-dist's types don't cover this subpath` comment
above the import if needed, rather than spending time chasing it further.

- [ ] **Step 4: Manually verify against a real statement**

This needs a real Cash App PDF statement to test against (the kind of file
this feature is built for — there's no synthetic substitute that exercises
the real library). In `backend/`, run:

```bash
node -e "
import('./src/services/cashAppStatementParser.ts').then(async ({parseCashAppStatementPdf}) => {
    const fs = await import('node:fs');
    const buffer = fs.readFileSync(process.argv[1]);
    const transactions = await parseCashAppStatementPdf(buffer);
    console.log('Parsed', transactions.length, 'transactions');
    console.log(transactions.slice(0, 3));
}).catch((err) => { console.error(err); process.exit(1); });
" /path/to/your/statement.pdf
```

Expected: no errors, a transaction count greater than zero, and the first
few printed transactions have a sensible `date` (`YYYY-MM-DD`), a
`description` combining the original Description and Details columns, and a
plausible `amount_cents`. If anything looks wrong, fix `statementRows.ts`,
`cashAppMapping.ts`, or this file before moving on — this is the one point in
the whole plan where the real file format gets checked.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/services/cashAppStatementParser.ts
git commit -m "Add Cash App PDF statement parser"
```

---

### Task 5: Import endpoints, router wiring, and integration tests

**Files:**
- Modify: `backend/package.json` (add `multer` + `@types/multer`)
- Create: `backend/src/controllers/transactionsImport.controller.ts`
- Modify: `backend/src/routes/transactions.router.ts`
- Create: `backend/src/testHelpers/httpServer.ts`
- Modify: `backend/src/app.test.ts` (use the shared `listen` helper instead of its own copy)
- Create: `backend/src/routes/transactionsImport.test.ts`

**Interfaces:**
- Consumes: `parseCashAppStatementPdf` (Task 4), `validateTransaction` from `../helpers/transactionValidation.ts` (existing), `TransactionService` (Task 3), `app` default export from `../app.ts` (existing).
- Produces: `previewImport(req, res)`, `confirmImport(req, res)` Express handlers. `listen(app: Express): Promise<{url: string, close: () => Promise<void>}>` shared test helper.

- [ ] **Step 1: Install multer**

```bash
cd backend && npm install multer && npm install -D @types/multer
```

- [ ] **Step 2: Extract the shared `listen` test helper**

`backend/src/app.test.ts` already has a local `listen` function for spinning
up the app on an ephemeral port. This task's new test file needs the same
thing, so pull it out once rather than duplicating it.

```typescript
// backend/src/testHelpers/httpServer.ts
import type {Express} from 'express';

/**
 * Starts an Express app on an ephemeral port for integration tests.
 *
 * @return The base URL to hit, and a close() to shut the server down.
 */
export function listen(app: Express): Promise<{url: string, close: () => Promise<void>}> {
    return new Promise((resolve) => {
        const server = app.listen(0, () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            resolve({
                url: `http://127.0.0.1:${port}`,
                close: () => new Promise((r) => server.close(() => r())),
            });
        });
    });
}
```

The existing `app.test.ts` calls `listen()` with no arguments (it closes over
`app` from the outer scope); the extracted helper takes `app` as a parameter,
so every call site needs `listen()` → `listen(app)` too, not just the import.

In `backend/src/app.test.ts`:

1. Replace the local `function listen(): Promise<...> { ... }` definition
   (the whole function, from `function listen()` through its closing `}`)
   with a single import line placed alongside the file's existing imports:

   ```typescript
   import {listen} from './testHelpers/httpServer.ts';
   ```

2. Change every `await listen()` call to `await listen(app)` — there are 5
   of them, one per `test(...)` block. Nothing else in the file changes.

- [ ] **Step 2a: Run the existing auth test suite to confirm nothing broke**

Run: `cd backend && node --test src/app.test.ts`
Expected: PASS (5 tests passing — the same ones from the auth feature, now using the shared helper).

- [ ] **Step 3: Write the failing tests**

```typescript
// backend/src/routes/transactionsImport.test.ts
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

test('the import endpoint requires authentication', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/transactions/import`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({transactions: []}),
        });
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('rejects a non-array transactions body', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/transactions/import`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({transactions: 'not-an-array'}),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('rejects the whole batch if any transaction is invalid', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/transactions/import`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({
                transactions: [
                    {date: '2026-09-05', description: 'Valid', amount_cents: 100, category_id: null, bill_id: null},
                    {date: 'not-a-date', description: 'Invalid', amount_cents: 100, category_id: null, bill_id: null},
                ],
            }),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('imports a valid batch and reports the created count', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/transactions/import`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Cookie: cookie},
            body: JSON.stringify({
                transactions: [
                    {date: '2026-09-05', description: 'First', amount_cents: 100, category_id: null, bill_id: null},
                    {date: '2026-09-06', description: 'Second', amount_cents: -200, category_id: null, bill_id: null},
                ],
            }),
        });
        assert.equal(res.status, 201);
        const body = await res.json();
        assert.equal(body.data.created, 2);
    } finally {
        await close();
    }
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd backend && node --test src/routes/transactionsImport.test.ts`
Expected: FAIL — `/api/v1/transactions/import` doesn't exist yet (404s, so the status-code assertions fail).

- [ ] **Step 5: Write the controller**

```typescript
// backend/src/controllers/transactionsImport.controller.ts
import type {Request, Response} from 'express';
import {parseCashAppStatementPdf} from '../services/cashAppStatementParser.ts';
import {validateTransaction} from '../helpers/transactionValidation.ts';
import {TransactionService} from '../services/transactions.service.ts';
import type {NewTransaction} from '../types/transaction.ts';

const transactionService = new TransactionService();

/**
 * Parses an uploaded PDF statement into candidate transactions, each flagged
 * with whether a similar transaction already exists. Writes nothing to the DB.
 */
export async function previewImport(req: Request, res: Response) {
    const file = req.file;

    if (!file) {
        return res.status(400).json({error: 'No file uploaded'});
    }

    if (file.mimetype !== 'application/pdf') {
        return res.status(400).json({error: 'File must be a PDF'});
    }

    let transactions: NewTransaction[];
    try {
        transactions = await parseCashAppStatementPdf(file.buffer);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not parse this PDF';
        return res.status(400).json({error: message});
    }

    const withDuplicateFlags = transactions.map((t) => ({
        ...t,
        isDuplicate: transactionService.existsSimilar(t.date, t.description, t.amount_cents),
    }));

    return res.status(200).json({data: {transactions: withDuplicateFlags}});
}

/**
 * Validates and inserts a confirmed batch of transactions, all-or-nothing.
 */
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

    const created = transactionService.createMany(validated);
    return res.status(201).json({data: {created: created.length}});
}
```

- [ ] **Step 6: Wire the router**

Modify `backend/src/routes/transactions.router.ts`:

```typescript
// backend/src/routes/transactions.router.ts
import express from "express";
import multer from "multer";
import {
    createTransaction, deleteTransaction,
    getAllTransactions,
    getTransactionById,
    updateTransaction
} from "../controllers/transactions.controller.ts";
import {previewImport, confirmImport} from "../controllers/transactionsImport.controller.ts";

const upload = multer({storage: multer.memoryStorage(), limits: {fileSize: 10 * 1024 * 1024}});

export const transactionsRouter = express.Router()

transactionsRouter.get('/', getAllTransactions);
transactionsRouter.post('/', createTransaction);
transactionsRouter.post('/import/preview', upload.single('file'), previewImport);
transactionsRouter.post('/import', confirmImport);
transactionsRouter.get('/:id', getTransactionById);
transactionsRouter.put('/:id', updateTransaction);
transactionsRouter.delete('/:id', deleteTransaction);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && node --test src/routes/transactionsImport.test.ts`
Expected: PASS (4 tests passing)

Also re-run the full suite to confirm the `listen` extraction didn't break `app.test.ts`:

Run: `cd backend && npm test`
Expected: all tests passing (previous count + these new ones).

- [ ] **Step 8: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/controllers/transactionsImport.controller.ts backend/src/routes/transactions.router.ts backend/src/testHelpers/httpServer.ts backend/src/app.test.ts backend/src/routes/transactionsImport.test.ts
git commit -m "Add transaction import preview/confirm endpoints"
```

---

### Task 6: Frontend types and ImportApiService

**Files:**
- Modify: `frontend/src/types/transaction.ts`
- Create: `frontend/src/services/ImportApiService.ts`

**Interfaces:**
- Produces: `type ImportCandidate = NewTransaction & {isDuplicate: boolean}`. `class ImportApiService` with `previewImport(file: File): Promise<ImportCandidate[]>`, `confirmImport(transactions: NewTransaction[]): Promise<number>`. Exported singleton `importApiService`.

- [ ] **Step 1: Add the type**

Append to `frontend/src/types/transaction.ts`:

```typescript
export type ImportCandidate = NewTransaction & {isDuplicate: boolean};
```

- [ ] **Step 2: Write the service**

This is a standalone class rather than a `BaseApiService` subclass, same
reasoning as `AuthApiService`: `BaseApiService`'s CRUD-shaped methods
(`getAll`/`getById`/`create`/`update`/`delete`) always target exactly
`this.path`, with no way to express two distinct sub-paths
(`/transactions/import/preview` vs `/transactions/import`) under one
instance.

```typescript
// frontend/src/services/ImportApiService.ts
import axios, {type AxiosInstance} from "axios";
import type {ApiErrorBody, ApiResponse} from "../types/api.ts";
import type {ImportCandidate} from "../types/transaction.ts";
import type {NewTransaction} from "../types/transaction.ts";

export class ImportApiService {
    private readonly http: AxiosInstance = axios.create({
        baseURL: import.meta.env.VITE_BASE_API_URL,
        withCredentials: true,
    })

    /**
     * Uploads a PDF statement and returns the parsed candidate transactions.
     * Writes nothing to the database.
     */
    async previewImport(file: File): Promise<ImportCandidate[]> {
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await this.http.post<ApiResponse<{transactions: ImportCandidate[]}>>(
                '/transactions/import/preview', formData
            );
            return res.data.data.transactions;
        } catch (error) {
            if (axios.isAxiosError<ApiErrorBody>(error)) {
                throw new Error(error.response?.data?.error ?? error.message, {cause: error});
            }
            throw error;
        }
    }

    /**
     * Validates and inserts a confirmed batch of transactions.
     *
     * @return The number of transactions created.
     */
    async confirmImport(transactions: NewTransaction[]): Promise<number> {
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
}

export const importApiService = new ImportApiService();
```

- [ ] **Step 3: Verify manually**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (clean type-check).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/transaction.ts frontend/src/services/ImportApiService.ts
git commit -m "Add ImportCandidate type and ImportApiService"
```

---

### Task 7: Import page

**Files:**
- Create: `frontend/src/import/Import.tsx`
- Create: `frontend/src/import/Import.css`

**Interfaces:**
- Consumes: `importApiService` (Task 6), `type ImportCandidate` (Task 6), `formatMoney` from `../helpers/money.ts` (existing), shared `.ledger`/`.ledger-row`/`.ledger-row__main`/`.ledger-date`/`.ledger-desc`/`.ledger-row__amount`/`.ledger-amount`/`.ledger-category`/`.ledger-status` classes from `../styles/ledger.css` (existing).
- Produces: `Import` — default export, a route element (no props).

- [ ] **Step 1: Write the component**

```typescript
// frontend/src/import/Import.tsx
import {useState, type ChangeEvent} from "react";
import {importApiService} from "../services/ImportApiService.ts";
import type {ImportCandidate, NewTransaction} from "../types/transaction.ts";
import {formatMoney} from "../helpers/money.ts";
import "../styles/ledger.css"
import './Import.css'

type Candidate = ImportCandidate & {selected: boolean};

function toNewTransaction({selected, isDuplicate, ...t}: Candidate): NewTransaction {
    return t;
}

function Import() {
    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<string | null>(null);

    async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) {
            return;
        }

        setLoading(true);
        setError(null);
        setResult(null);
        setCandidates([]);

        try {
            const parsed = await importApiService.previewImport(file);
            setCandidates(parsed.map((c) => ({...c, selected: !c.isDuplicate})));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not parse this file');
        } finally {
            setLoading(false);
            e.target.value = '';
        }
    }

    function toggle(index: number) {
        setCandidates((prev) => prev.map((c, i) => i === index ? {...c, selected: !c.selected} : c));
    }

    async function handleConfirm() {
        setLoading(true);
        setError(null);

        const selected = candidates.filter((c) => c.selected).map(toNewTransaction);

        try {
            const created = await importApiService.confirmImport(selected);
            setResult(`Imported ${created} transaction${created === 1 ? '' : 's'}.`);
            setCandidates([]);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not import these transactions');
        } finally {
            setLoading(false);
        }
    }

    const selectedCount = candidates.filter((c) => c.selected).length;

    return (
        <>
            <div className="import-picker">
                <label className="import-file-label">
                    <input type="file" accept="application/pdf" onChange={handleFileChange} disabled={loading}/>
                    Choose a Cash App statement PDF
                </label>
            </div>

            {loading && <p className="ledger-status">Working…</p>}
            {error && <p className="ledger-status error">{error}</p>}
            {result && <p className="ledger-status">{result}</p>}

            {candidates.length > 0 && (
                <>
                    <div className="ledger">
                        {candidates.map((c, i) => (
                            <article className="ledger-row import-row" key={i}>
                                <input
                                    type="checkbox"
                                    checked={c.selected}
                                    onChange={() => toggle(i)}
                                    aria-label={`Include ${c.description}`}
                                />
                                <div className="ledger-row__main">
                                    <time className="ledger-date" dateTime={c.date}>{c.date}</time>
                                    <span className="ledger-desc">{c.description}</span>
                                    {c.isDuplicate && (
                                        <span className="ledger-category import-duplicate">Possible duplicate</span>
                                    )}
                                </div>
                                <div className="ledger-row__amount">
                                    <span className={`ledger-amount ${c.amount_cents < 0 ? 'debit' : 'credit'}`}>
                                        {formatMoney(c.amount_cents)}
                                    </span>
                                </div>
                            </article>
                        ))}
                    </div>
                    <button
                        type="button"
                        className="import-confirm"
                        onClick={handleConfirm}
                        disabled={loading || selectedCount === 0}
                    >
                        Import {selectedCount} transaction{selectedCount === 1 ? '' : 's'}
                    </button>
                </>
            )}
        </>
    )
}

export default Import
```

- [ ] **Step 2: Write the styles**

```css
/* frontend/src/import/Import.css */
.import-picker {
  margin-bottom: 1.5rem;
}

.import-file-label {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  font-family: var(--sans);
  font-size: 0.9rem;
  color: var(--text-on-ink-strong);
  cursor: pointer;
}

.import-row input[type="checkbox"] {
  width: 1.1rem;
  height: 1.1rem;
  accent-color: var(--due);
  flex-shrink: 0;
}

.import-duplicate {
  color: var(--due);
  border-color: var(--due);
}

.import-confirm {
  margin-top: 1.5rem;
  font-family: var(--sans);
  font-weight: 600;
  font-size: 0.95rem;
  background: var(--credit-dim);
  color: var(--text-on-ink-strong);
  border: none;
  border-radius: 4px;
  padding: 0.7rem 1.3rem;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.import-confirm:hover {
  opacity: 0.85;
}

.import-confirm:disabled {
  opacity: 0.5;
  cursor: default;
}

.import-confirm:focus-visible {
  outline: 2px solid var(--due);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Verify manually**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (clean type-check). (Not reachable in the browser until Task 8 wires the route.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/import/Import.tsx frontend/src/import/Import.css
git commit -m "Add Import page"
```

---

### Task 8: Wire the /import route and nav link

**Files:**
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/Layout.tsx`

**Interfaces:**
- Consumes: `Import` (Task 7).

- [ ] **Step 1: Add the route**

In `frontend/src/main.tsx`, add the import and route (inside the authenticated `Layout` block, alongside the existing `/dashboard` and `/transactions` routes):

```typescript
import Import from './import/Import.tsx'
```

```typescript
            <Route element={<Layout/>}>
              <Route path="/dashboard" element={<App/>}/>
              <Route path="/transactions" element={<Transactions/>}/>
              <Route path="/import" element={<Import/>}/>
            </Route>
```

- [ ] **Step 2: Add the nav link**

In `frontend/src/Layout.tsx`, add a link alongside the existing Dashboard/Transactions links:

```typescript
                <nav className="tape-nav" aria-label="Primary">
                    <NavLink to="/dashboard" className={navClass}>Dashboard</NavLink>
                    <NavLink to="/transactions" className={navClass}>Transactions</NavLink>
                    <NavLink to="/import" className={navClass}>Import</NavLink>
                </nav>
```

- [ ] **Step 3: Verify manually**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (clean type-check).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/main.tsx frontend/src/Layout.tsx
git commit -m "Wire the /import route into the router and nav"
```

---

### Task 9: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: all tests passing.

- [ ] **Step 2: Start both servers**

Run: `cd backend && npm run dev`
Run (separate terminal): `cd frontend && npm run dev`

- [ ] **Step 3: Log in and open Import**

In a browser, log in, then click "Import" in the nav. Confirm the file picker renders.

- [ ] **Step 4: Upload a real Cash App statement PDF**

Choose a real statement file. Expected: a loading state, then a preview list
of transactions in the ledger-row style, each with a checkbox (checked by
default).

- [ ] **Step 5: Confirm the import**

Click "Import N transactions". Expected: a success message with the count,
and the preview list clears.

- [ ] **Step 6: Confirm the transactions actually landed**

Navigate to Dashboard and Transactions. Expected: the imported transactions
appear, with correct dates, descriptions (combining Description and Details),
and amounts (fee folded in, correct sign).

- [ ] **Step 7: Confirm duplicate flagging on a second import**

Upload the *same* PDF again. Expected: every row is now flagged "Possible
duplicate" and unchecked by default (since they now all match existing
transactions). Confirming with everything unchecked should import 0 and show
"Imported 0 transactions." — confirming duplicates are informational, not
auto-excluded from the request, and confirming an empty selection is handled
gracefully.

- [ ] **Step 8: Confirm canceled rows were skipped**

If the statement contains a "(canceled)" row, confirm it does *not* appear in
the preview list at all.

No commit for this task — it's verification only, confirming Tasks 1–8 work
together against a real file.
