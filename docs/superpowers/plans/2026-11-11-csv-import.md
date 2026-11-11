# CSV Import With Column Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user import transactions from any bank/app's CSV export by mapping which column is the date, description, and amount — reusing the existing import-preview/confirm pipeline (suggestion stack, duplicate detection) unchanged.

**Architecture:** A pure CSV parser + generic date/amount parsers (no new dependency) feed a pure row-mapper that turns `(headers, rows, columnMapping)` into `NewTransaction[]` plus per-row parse errors. The existing `previewImport` controller's post-parse suggestion/duplicate logic is extracted into a shared `buildImportCandidates` function reused by a new `previewCsvImport` handler. The existing confirm endpoint (`POST /transactions/import`) is untouched and reused as-is. The frontend adds a format toggle + column-mapping UI to the existing `Import.tsx`, reusing its candidate-review list verbatim.

**Tech Stack:** Node 26+, Express 5, TypeScript run directly by Node, React 19 + Vite + Axios, `multer` (already a dependency).

## Global Constraints

- No ORM, plain SQL, `STRICT` tables — this plan adds no new tables/columns.
- TypeScript throughout; local imports use explicit `.ts`/`.tsx` extensions.
- Backend tests use Node's built-in test runner (`node --test`). Every test file that touches the DB sets `process.env.DATABASE_FILE = ':memory:'` before the first dynamic `import` of anything touching `db.ts`.
- Backend code style: JSDoc `/** ... */` above exported functions/methods. No such comments in frontend `.tsx`/`.ts` files.
- No frontend test framework — frontend verification is `npx tsc -b --noEmit` plus a manual check in the running app.
- No new runtime dependencies — the CSV parser is hand-written (confirmed in the design spec: the project avoids extra dependencies where a small parser suffices).
- Follow existing patterns exactly: reuse `ledger-row`/`ledger-category-select`/`NewCategoryBadge`/`import-ai-badge`/`import-confirm` CSS classes and the existing candidate-review list in `Import.tsx` rather than building new review UI.

---

### Task 1: CSV/date/amount parsing helpers

**Files:**
- Create: `backend/src/helpers/csvParsing.ts`
- Test: `backend/src/helpers/csvParsing.test.ts`

**Interfaces:**
- Produces: `parseCsv(text: string): string[][]`, `parseGenericDate(raw: string): string` (returns `YYYY-MM-DD`, throws on unparseable), `parseGenericAmount(raw: string): number` (returns integer cents, throws on unparseable). Task 2 depends on all three.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/helpers/csvParsing.test.ts`:

```ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv, parseGenericDate, parseGenericAmount} from './csvParsing.ts';

test('parseCsv splits a simple CSV into header and rows', () => {
    const result = parseCsv('Date,Amount\n2026-01-01,10.00\n2026-01-02,20.00\n');
    assert.deepEqual(result, [
        ['Date', 'Amount'],
        ['2026-01-01', '10.00'],
        ['2026-01-02', '20.00'],
    ]);
});

test('parseCsv handles quoted fields with embedded commas', () => {
    const result = parseCsv('"Date","Notes"\n"2026-01-01","Hello, world"\n');
    assert.deepEqual(result, [
        ['Date', 'Notes'],
        ['2026-01-01', 'Hello, world'],
    ]);
});

test('parseCsv un-escapes doubled quotes inside a quoted field', () => {
    const result = parseCsv('"Notes"\n"She said ""hi"""\n');
    assert.deepEqual(result, [
        ['Notes'],
        ['She said "hi"'],
    ]);
});

test('parseCsv handles a file with no trailing newline', () => {
    const result = parseCsv('Date,Amount\n2026-01-01,10.00');
    assert.deepEqual(result, [
        ['Date', 'Amount'],
        ['2026-01-01', '10.00'],
    ]);
});

test('parseGenericDate takes the leading date from an ISO date with time and timezone', () => {
    assert.equal(parseGenericDate('2026-11-11 16:42:35 CST'), '2026-11-11');
});

test('parseGenericDate accepts a bare ISO date', () => {
    assert.equal(parseGenericDate('2026-11-11'), '2026-11-11');
});

test('parseGenericDate accepts MM/DD/YYYY', () => {
    assert.equal(parseGenericDate('3/4/2026'), '2026-03-04');
});

test('parseGenericDate throws on an unrecognized format', () => {
    assert.throws(() => parseGenericDate('not a date'));
});

test('parseGenericAmount parses a dollar-prefixed negative amount', () => {
    assert.equal(parseGenericAmount('-$2.10'), -210);
});

test('parseGenericAmount parses a plain positive amount', () => {
    assert.equal(parseGenericAmount('$0.00'), 0);
});

test('parseGenericAmount treats a parenthesized amount as negative', () => {
    assert.equal(parseGenericAmount('(12.34)'), -1234);
});

test('parseGenericAmount strips thousands commas', () => {
    assert.equal(parseGenericAmount('$1,234.56'), 123456);
});

test('parseGenericAmount throws when there are no digits', () => {
    assert.throws(() => parseGenericAmount(''));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test src/helpers/csvParsing.test.ts`
Expected: FAIL with "Cannot find module './csvParsing.ts'" (the file doesn't exist yet).

- [ ] **Step 3: Implement the helpers**

Create `backend/src/helpers/csvParsing.ts`:

```ts
const ISO_PREFIX = /^(\d{4}-\d{2}-\d{2})/;
const US_SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/;

/**
 * Parses CSV text into rows of raw string fields (row 0 is the header row).
 * A small RFC4180-ish parser: handles quoted fields (which may contain
 * commas or newlines) and doubled `""` as an escaped quote inside a quoted
 * field. Trailing blank rows (e.g. from a trailing newline) are dropped.
 */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    let i = 0;

    function endField() {
        row.push(field);
        field = '';
    }

    function endRow() {
        endField();
        rows.push(row);
        row = [];
    }

    while (i < text.length) {
        const char = text[i];

        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i++;
                continue;
            }
            field += char;
            i++;
            continue;
        }

        if (char === '"') {
            inQuotes = true;
            i++;
        } else if (char === ',') {
            endField();
            i++;
        } else if (char === '\r') {
            i++;
        } else if (char === '\n') {
            endRow();
            i++;
        } else {
            field += char;
            i++;
        }
    }

    if (field !== '' || row.length > 0) {
        endRow();
    }

    return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/**
 * Parses a date column value into YYYY-MM-DD. Recognizes a leading ISO date
 * (optionally followed by a time and/or timezone, e.g.
 * "2026-11-11 16:42:35 CST" — the time/timezone is intentionally ignored,
 * since a statement date is a wall-clock calendar date, not an instant, and
 * converting it would risk the kind of off-by-one timezone bug already hit
 * elsewhere in this project's date-range math) and MM/DD/YYYY.
 *
 * @throws Error if the value matches neither recognized format.
 */
export function parseGenericDate(raw: string): string {
    const trimmed = raw.trim();

    const isoMatch = trimmed.match(ISO_PREFIX);
    if (isoMatch) {
        return isoMatch[1];
    }

    const slashMatch = trimmed.match(US_SLASH);
    if (slashMatch) {
        const [, month, day, year] = slashMatch;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    throw new Error(`Could not parse date: "${raw}"`);
}

/**
 * Parses an amount column value into integer cents. Strips `$`, thousands
 * commas, and whitespace; a value wrapped in parentheses or with a leading
 * `-` is treated as negative.
 *
 * @throws Error if no digits remain after stripping formatting characters.
 */
export function parseGenericAmount(raw: string): number {
    const trimmed = raw.trim();
    const isParenNegative = /^\(.*\)$/.test(trimmed);
    const stripped = trimmed.replace(/[()$,\s]/g, '');
    const isNegative = isParenNegative || stripped.startsWith('-');
    const digits = stripped.replace(/^-/, '');

    if (digits === '' || !/^\d+(\.\d+)?$/.test(digits)) {
        throw new Error(`Could not parse amount: "${raw}"`);
    }

    const value = Number(digits);
    return Math.round(value * 100) * (isNegative ? -1 : 1);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test src/helpers/csvParsing.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/helpers/csvParsing.ts backend/src/helpers/csvParsing.test.ts
git commit -m "Add generic CSV/date/amount parsing helpers"
```

---

### Task 2: CSV row-to-transaction mapper

**Files:**
- Create: `backend/src/services/csvImportMapper.service.ts`
- Test: `backend/src/services/csvImportMapper.service.test.ts`

**Interfaces:**
- Consumes: `parseGenericDate`, `parseGenericAmount` from Task 1.
- Produces: `type CsvColumnMapping = {date: string, description: string, amount: string}` and `mapCsvToTransactions(headers: string[], rows: string[][], mapping: CsvColumnMapping): {transactions: NewTransaction[], errors: {row: number, message: string}[]}`. Task 3 depends on both the type and the function. Precondition (caller's responsibility, enforced in Task 3): every one of `mapping.date`/`description`/`amount` is present in `headers`.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/csvImportMapper.service.test.ts`:

```ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapCsvToTransactions} from './csvImportMapper.service.ts';

const headers = ['Date', 'Notes', 'Amount'];

test('maps good rows to transactions using the given column mapping', () => {
    const rows = [
        ['2026-11-11 16:42:35 CST', 'CTLP*J&S VENDING', '-$2.10'],
        ['2026-11-10 09:24:01 CST', 'Add Cash', '$50.00'],
    ];
    const {transactions, errors} = mapCsvToTransactions(headers, rows, {
        date: 'Date', description: 'Notes', amount: 'Amount',
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(transactions, [
        {date: '2026-11-11', description: 'CTLP*J&S VENDING', amount_cents: -210, category_id: null, bill_id: null},
        {date: '2026-11-10', description: 'Add Cash', amount_cents: 5000, category_id: null, bill_id: null},
    ]);
});

test('collects a bad row into errors with its 1-indexed row number, and still processes the rest', () => {
    const rows = [
        ['2026-11-11 16:42:35 CST', 'Good row', '-$2.10'],
        ['not a date', 'Bad row', '-$2.10'],
        ['2026-11-10 09:24:01 CST', 'Another good row', '$50.00'],
    ];
    const {transactions, errors} = mapCsvToTransactions(headers, rows, {
        date: 'Date', description: 'Notes', amount: 'Amount',
    });
    assert.equal(transactions.length, 2);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].row, 2);
    assert.match(errors[0].message, /not a date/);
});

test('collects a row with an empty description into errors', () => {
    const rows = [['2026-11-11', '', '$10.00']];
    const {transactions, errors} = mapCsvToTransactions(headers, rows, {
        date: 'Date', description: 'Notes', amount: 'Amount',
    });
    assert.equal(transactions.length, 0);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].row, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test src/services/csvImportMapper.service.test.ts`
Expected: FAIL with "Cannot find module './csvImportMapper.service.ts'".

- [ ] **Step 3: Implement the mapper**

Create `backend/src/services/csvImportMapper.service.ts`:

```ts
import {parseGenericDate, parseGenericAmount} from '../helpers/csvParsing.ts';
import type {NewTransaction} from '../types/transaction.ts';

export type CsvColumnMapping = {date: string, description: string, amount: string};
export type CsvRowError = {row: number, message: string};

/**
 * Maps raw CSV rows into transactions using the given column-name mapping.
 * A row whose mapped date/amount can't be parsed, or whose mapped
 * description is empty, is skipped and recorded in `errors` (1-indexed by
 * the row's position in `rows`, i.e. row 1 is the first data row after the
 * header) rather than throwing — the rest of the file still processes.
 *
 * Assumes every column name in `mapping` is present in `headers`; the
 * caller is responsible for validating that first.
 */
export function mapCsvToTransactions(
    headers: string[], rows: string[][], mapping: CsvColumnMapping
): {transactions: NewTransaction[], errors: CsvRowError[]} {
    const dateIndex = headers.indexOf(mapping.date);
    const descriptionIndex = headers.indexOf(mapping.description);
    const amountIndex = headers.indexOf(mapping.amount);

    const transactions: NewTransaction[] = [];
    const errors: CsvRowError[] = [];

    rows.forEach((row, i) => {
        const rowNumber = i + 1;
        try {
            const date = parseGenericDate(row[dateIndex] ?? '');
            const description = (row[descriptionIndex] ?? '').trim();
            if (description === '') {
                throw new Error('Description is empty');
            }
            const amount_cents = parseGenericAmount(row[amountIndex] ?? '');
            transactions.push({date, description, amount_cents, category_id: null, bill_id: null});
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Could not parse this row';
            errors.push({row: rowNumber, message});
        }
    });

    return {transactions, errors};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test src/services/csvImportMapper.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/csvImportMapper.service.ts backend/src/services/csvImportMapper.service.test.ts
git commit -m "Add CSV row-to-transaction mapper with per-row error collection"
```

---

### Task 3: Backend endpoint — `POST /transactions/import/csv/preview`

**Files:**
- Modify: `backend/src/controllers/transactionsImport.controller.ts`
- Modify: `backend/src/routes/transactions.router.ts`
- Test: `backend/src/routes/transactionsCsvImport.test.ts`

**Interfaces:**
- Consumes: `parseCsv` (Task 1), `mapCsvToTransactions`/`CsvColumnMapping`/`CsvRowError` (Task 2).
- Produces: `previewCsvImport(req, res)` handler mounted at `POST /api/v1/transactions/import/csv/preview` (multipart: a `file` field plus `dateColumn`/`descriptionColumn`/`amountColumn` text fields), behind the router's existing `requireAuth`. Response on success: `{data: {transactions: ImportCandidate[], errors: CsvRowError[]}}`. Confirming uses the **existing, unchanged** `POST /transactions/import`. Task 4 depends on this response shape.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/routes/transactionsCsvImport.test.ts`:

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

function csvFormData(
    csv: string, mapping: {dateColumn: string, descriptionColumn: string, amountColumn: string}
): FormData {
    const formData = new FormData();
    formData.append('file', new Blob([csv], {type: 'text/csv'}), 'statement.csv');
    formData.append('dateColumn', mapping.dateColumn);
    formData.append('descriptionColumn', mapping.descriptionColumn);
    formData.append('amountColumn', mapping.amountColumn);
    return formData;
}

test('the csv preview endpoint requires authentication', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/transactions/import/csv/preview`, {
            method: 'POST',
            body: csvFormData('Date,Notes,Amount\n2026-01-01,Coffee,-5.00\n', {
                dateColumn: 'Date', descriptionColumn: 'Notes', amountColumn: 'Amount',
            }),
        });
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('rejects a request missing a column mapping field', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const formData = new FormData();
        formData.append('file', new Blob(['Date,Notes,Amount\n'], {type: 'text/csv'}), 'statement.csv');
        formData.append('dateColumn', 'Date');
        const res = await fetch(`${url}/api/v1/transactions/import/csv/preview`, {
            method: 'POST',
            headers: {Cookie: cookie},
            body: formData,
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('rejects an unknown column name', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/transactions/import/csv/preview`, {
            method: 'POST',
            headers: {Cookie: cookie},
            body: csvFormData('Date,Notes,Amount\n2026-01-01,Coffee,-5.00\n', {
                dateColumn: 'Date', descriptionColumn: 'Notes', amountColumn: 'NotAColumn',
            }),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('returns candidates for good rows and errors for bad rows', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const csv = 'Date,Notes,Amount\n'
            + '2026-01-01,Coffee Shop CSV Test,-5.00\n'
            + 'not a date,Bad Row,-1.00\n';
        const res = await fetch(`${url}/api/v1/transactions/import/csv/preview`, {
            method: 'POST',
            headers: {Cookie: cookie},
            body: csvFormData(csv, {dateColumn: 'Date', descriptionColumn: 'Notes', amountColumn: 'Amount'}),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.data.transactions.length, 1);
        assert.equal(body.data.transactions[0].description, 'Coffee Shop CSV Test');
        assert.equal(body.data.errors.length, 1);
        assert.equal(body.data.errors[0].row, 2);
    } finally {
        await close();
    }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test src/routes/transactionsCsvImport.test.ts`
Expected: FAIL — the route doesn't exist yet (404s), so the status assertions on the last three tests fail (the first, auth test, may happen to pass since a 404 isn't 401 either, but the other three must fail).

- [ ] **Step 3: Refactor the controller and add the handler**

Modify `backend/src/controllers/transactionsImport.controller.ts` — replace the whole file:

```ts
import type {Request, Response} from 'express';
import {parseCashAppStatementPdf} from '../services/cashAppStatementParser.ts';
import {parseCsv} from '../helpers/csvParsing.ts';
import {mapCsvToTransactions} from '../services/csvImportMapper.service.ts';
import {validateTransaction} from '../helpers/transactionValidation.ts';
import {TransactionService} from '../services/transactions.service.ts';
import {CategoryRuleService} from '../services/categoryRules.service.ts';
import {suggestCategories} from '../services/ollamaCategorySuggester.service.ts';
import {resolveNewCategories} from '../services/importCategoryResolver.service.ts';
import type {ImportConfirmItem} from '../services/importCategoryResolver.service.ts';
import type {ImportCandidate, NewTransaction} from '../types/transaction.ts';

const transactionService = new TransactionService();
const categoryRuleService = new CategoryRuleService();

/**
 * Enriches parsed transactions with a suggested category (exact-history
 * match, then keyword rule, then a local-Ollama fallback for anything still
 * unmatched) and an `isDuplicate` flag, regardless of which parser produced
 * them. Shared by both the PDF and CSV preview endpoints.
 */
async function buildImportCandidates(transactions: NewTransaction[]): Promise<ImportCandidate[]> {
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

    return withRuleSuggestions.map((t) => {
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
}

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

    const candidates = await buildImportCandidates(transactions);
    return res.status(200).json({data: {transactions: candidates}});
}

/**
 * Parses an uploaded CSV file into candidate transactions using a
 * user-chosen column mapping (date/description/amount column names). Rows
 * that fail to parse are reported in `errors` and skipped rather than
 * failing the whole upload. Writes nothing to the DB.
 */
export async function previewCsvImport(req: Request, res: Response) {
    const file = req.file;
    if (!file) {
        return res.status(400).json({error: 'No file uploaded'});
    }

    const dateColumn = req.body?.dateColumn;
    const descriptionColumn = req.body?.descriptionColumn;
    const amountColumn = req.body?.amountColumn;
    if (
        typeof dateColumn !== 'string' || typeof descriptionColumn !== 'string'
        || typeof amountColumn !== 'string'
    ) {
        return res.status(400).json({error: 'dateColumn, descriptionColumn, and amountColumn are required'});
    }

    const rows = parseCsv(file.buffer.toString('utf-8'));
    if (rows.length === 0) {
        return res.status(400).json({error: 'CSV file is empty'});
    }
    const [headers, ...dataRows] = rows;

    const requestedColumns: [string, string][] = [
        ['dateColumn', dateColumn], ['descriptionColumn', descriptionColumn], ['amountColumn', amountColumn],
    ];
    for (const [label, column] of requestedColumns) {
        if (!headers.includes(column)) {
            return res.status(400).json({error: `${label} "${column}" is not a column in this CSV`});
        }
    }

    const {transactions, errors} = mapCsvToTransactions(headers, dataRows, {
        date: dateColumn, description: descriptionColumn, amount: amountColumn,
    });

    const candidates = await buildImportCandidates(transactions);
    return res.status(200).json({data: {transactions: candidates, errors}});
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

    const withNewCategoryNames: ImportConfirmItem[] = validated.map((t, i) => ({
        ...t,
        newCategoryName: body[i]?.newCategoryName,
    }));
    const resolved = resolveNewCategories(withNewCategoryNames);

    const created = transactionService.createMany(resolved);
    return res.status(201).json({data: {created: created.length}});
}
```

Modify `backend/src/routes/transactions.router.ts`:

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
import {previewImport, previewCsvImport, confirmImport} from "../controllers/transactionsImport.controller.ts";

const upload = multer({storage: multer.memoryStorage(), limits: {fileSize: 10 * 1024 * 1024}});

export const transactionsRouter = express.Router()

transactionsRouter.get('/', getAllTransactions);
transactionsRouter.post('/', createTransaction);
transactionsRouter.post('/suggest-category', suggestCategoryForDescription);
transactionsRouter.post('/import/preview', upload.single('file'), previewImport);
transactionsRouter.post('/import/csv/preview', upload.single('file'), previewCsvImport);
transactionsRouter.post('/import', confirmImport);
transactionsRouter.get('/:id', getTransactionById);
transactionsRouter.put('/:id', updateTransaction);
transactionsRouter.delete('/:id', deleteTransaction);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test src/routes/transactionsCsvImport.test.ts`
Expected: PASS (4 tests).

Also run the full backend suite (this task refactored `previewImport`, so the existing PDF import tests must still pass unchanged):
Run: `cd backend && node --test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/transactionsImport.controller.ts backend/src/routes/transactions.router.ts backend/src/routes/transactionsCsvImport.test.ts
git commit -m "Add POST /transactions/import/csv/preview endpoint"
```

---

### Task 4: Frontend API client + types

**Files:**
- Modify: `frontend/src/types/transaction.ts`
- Modify: `frontend/src/services/ImportApiService.ts`

**Interfaces:**
- Consumes: Task 3's `POST /transactions/import/csv/preview` response shape.
- Produces: `export type CsvRowError = {row: number, message: string}` in `frontend/src/types/transaction.ts`, and `importApiService.previewCsvImport(file: File, mapping: {dateColumn: string, descriptionColumn: string, amountColumn: string}): Promise<{transactions: ImportCandidate[], errors: CsvRowError[]}>`. Task 5 depends on both.

- [ ] **Step 1: Add the `CsvRowError` type**

Modify `frontend/src/types/transaction.ts` — append:

```ts
export type CsvRowError = {row: number, message: string};
```

- [ ] **Step 2: Add `previewCsvImport` to `ImportApiService`**

Modify `frontend/src/services/ImportApiService.ts` — update the type import and add the method (e.g. right after `previewImport`):

```ts
import axios, {type AxiosInstance} from "axios";
import type {ApiErrorBody, ApiResponse} from "../types/api.ts";
import type {CsvRowError, ImportCandidate, ImportConfirmItem} from "../types/transaction.ts";
```

```ts
    /**
     * Uploads a CSV file plus a column mapping and returns the parsed
     * candidate transactions, along with any rows that failed to parse.
     * Writes nothing to the database.
     */
    async previewCsvImport(
        file: File, mapping: {dateColumn: string, descriptionColumn: string, amountColumn: string}
    ): Promise<{transactions: ImportCandidate[], errors: CsvRowError[]}> {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('dateColumn', mapping.dateColumn);
        formData.append('descriptionColumn', mapping.descriptionColumn);
        formData.append('amountColumn', mapping.amountColumn);

        try {
            const res = await this.http.post<ApiResponse<{transactions: ImportCandidate[], errors: CsvRowError[]}>>(
                '/transactions/import/csv/preview', formData
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
git add frontend/src/types/transaction.ts frontend/src/services/ImportApiService.ts
git commit -m "Add previewCsvImport to ImportApiService"
```

---

### Task 5: CSV format toggle + column-mapping UI in `Import.tsx`

**Files:**
- Create: `frontend/src/helpers/csv.ts`
- Modify: `frontend/src/import/Import.tsx`
- Modify: `frontend/src/import/Import.css`

**Interfaces:**
- Consumes: `importApiService.previewCsvImport` (Task 4); `ImportCandidate`/`CsvRowError` types (Task 4/existing).
- Produces: `parseCsvHeaderRow(text: string): string[]`, `guessDateColumn`, `guessDescriptionColumn`, `guessAmountColumn` (all `(headers: string[]) => string`) in `frontend/src/helpers/csv.ts`. Nothing downstream consumes these beyond `Import.tsx` in this same task.

- [ ] **Step 1: Add the client-side header-parsing/guessing helpers**

Create `frontend/src/helpers/csv.ts`:

```ts
export function parseCsvHeaderRow(text: string): string[] {
    const firstLine = text.split(/\r\n|\n/, 1)[0] ?? '';
    const headers: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < firstLine.length; i++) {
        const char = firstLine[i];
        if (inQuotes) {
            if (char === '"') {
                if (firstLine[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
            continue;
        }
        if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            headers.push(field);
            field = '';
        } else {
            field += char;
        }
    }
    headers.push(field);

    return headers;
}

export function guessDateColumn(headers: string[]): string {
    return headers.find((h) => h.toLowerCase().includes('date')) ?? headers[0] ?? '';
}

export function guessDescriptionColumn(headers: string[]): string {
    const keywords = ['description', 'desc', 'notes', 'memo'];
    return headers.find((h) => keywords.some((k) => h.toLowerCase().includes(k))) ?? headers[0] ?? '';
}

export function guessAmountColumn(headers: string[]): string {
    const netAmount = headers.find((h) => {
        const lower = h.toLowerCase();
        return lower.includes('net') && lower.includes('amount');
    });
    if (netAmount) {
        return netAmount;
    }
    return headers.find((h) => h.toLowerCase().includes('amount')) ?? headers[0] ?? '';
}
```

- [ ] **Step 2: Wire the format toggle and CSV flow into `Import.tsx`**

Modify `frontend/src/import/Import.tsx` — replace the whole file:

```tsx
import {useEffect, useState, type ChangeEvent} from "react";
import {importApiService} from "../services/ImportApiService.ts";
import {categoryApiService} from "../services/CategoryApiService.ts";
import type {CsvRowError, ImportCandidate, ImportConfirmItem} from "../types/transaction.ts";
import type {Category} from "../types/category.ts";
import {formatMoney} from "../helpers/money.ts";
import {categoryName} from "../helpers/ledger.ts";
import {parseCsvHeaderRow, guessDateColumn, guessDescriptionColumn, guessAmountColumn} from "../helpers/csv.ts";
import SaveAsRuleButton from "../rules/SaveAsRuleButton.tsx";
import NewCategoryBadge from "../rules/NewCategoryBadge.tsx";
import "../styles/ledger.css"
import './Import.css'

type Candidate = ImportCandidate & {selected: boolean};
type Format = 'pdf' | 'csv';

function toNewTransaction({selected, isDuplicate, proposedCategoryName, ...t}: Candidate): ImportConfirmItem {
    return proposedCategoryName ? {...t, newCategoryName: proposedCategoryName} : t;
}

function Import() {
    const [format, setFormat] = useState<Format>('pdf');
    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<string | null>(null);
    const [editingCategoryFor, setEditingCategoryFor] = useState<number | null>(null);

    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
    const [dateColumn, setDateColumn] = useState('');
    const [descriptionColumn, setDescriptionColumn] = useState('');
    const [amountColumn, setAmountColumn] = useState('');
    const [csvErrors, setCsvErrors] = useState<CsvRowError[]>([]);

    useEffect(() => {
        categoryApiService.getAllCategories().then(setCategories).catch(() => {});
    }, [])

    function resetPreview() {
        setError(null);
        setResult(null);
        setCandidates([]);
        setCsvErrors([]);
    }

    function handleFormatChange(f: Format) {
        setFormat(f);
        resetPreview();
        setCsvFile(null);
        setCsvHeaders([]);
    }

    async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) {
            return;
        }

        setLoading(true);
        resetPreview();

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

    async function handleCsvFileChange(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) {
            return;
        }

        resetPreview();
        setCsvFile(file);

        const text = await file.text();
        const headers = parseCsvHeaderRow(text);
        setCsvHeaders(headers);
        setDateColumn(guessDateColumn(headers));
        setDescriptionColumn(guessDescriptionColumn(headers));
        setAmountColumn(guessAmountColumn(headers));
    }

    async function handlePreviewCsv() {
        if (!csvFile) {
            return;
        }

        setLoading(true);
        setError(null);
        setResult(null);
        setCsvErrors([]);

        try {
            const {transactions, errors} = await importApiService.previewCsvImport(csvFile, {
                dateColumn, descriptionColumn, amountColumn,
            });
            setCandidates(transactions.map((c) => ({...c, selected: !c.isDuplicate && c.amount_cents !== 0})));
            setCsvErrors(errors);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not parse this file');
        } finally {
            setLoading(false);
        }
    }

    function toggle(index: number) {
        setCandidates((prev) => prev.map((c, i) => i === index ? {...c, selected: !c.selected} : c));
    }

    function updateCandidateCategory(index: number, value: string) {
        const category_id = value === '' ? null : Number(value);
        setCandidates((prev) => prev.map((c, i) =>
            i === index ? {...c, category_id, aiSuggested: false, proposedCategoryName: null} : c
        ));
        setEditingCategoryFor(null);
    }

    function updateProposedCategoryName(index: number, name: string) {
        setCandidates((prev) => prev.map((c, i) => i === index ? {...c, proposedCategoryName: name} : c));
    }

    function pickExistingInstead(index: number) {
        setCandidates((prev) => prev.map((c, i) => i === index ? {...c, proposedCategoryName: null} : c));
        setEditingCategoryFor(index);
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
            <div className="import-format-toggle">
                <button
                    type="button"
                    className={`import-format-button ${format === 'pdf' ? 'import-format-button--active' : ''}`}
                    onClick={() => handleFormatChange('pdf')}
                >
                    PDF statement
                </button>
                <button
                    type="button"
                    className={`import-format-button ${format === 'csv' ? 'import-format-button--active' : ''}`}
                    onClick={() => handleFormatChange('csv')}
                >
                    CSV file
                </button>
            </div>

            {format === 'pdf' ? (
                <div className="import-picker">
                    <label className="import-file-label">
                        <input type="file" accept="application/pdf" onChange={handleFileChange} disabled={loading}/>
                        Choose a statement PDF
                    </label>
                </div>
            ) : (
                <div className="import-picker">
                    <label className="import-file-label">
                        <input type="file" accept=".csv,text/csv" onChange={handleCsvFileChange} disabled={loading}/>
                        Choose a CSV file
                    </label>
                    {csvHeaders.length > 0 && (
                        <div className="import-csv-mapping">
                            <label className="import-csv-mapping-field">
                                <span>Date column</span>
                                <select value={dateColumn} onChange={(e) => setDateColumn(e.target.value)}>
                                    {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                                </select>
                            </label>
                            <label className="import-csv-mapping-field">
                                <span>Description column</span>
                                <select value={descriptionColumn} onChange={(e) => setDescriptionColumn(e.target.value)}>
                                    {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                                </select>
                            </label>
                            <label className="import-csv-mapping-field">
                                <span>Amount column</span>
                                <select value={amountColumn} onChange={(e) => setAmountColumn(e.target.value)}>
                                    {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                                </select>
                            </label>
                            <button
                                type="button"
                                className="import-confirm"
                                onClick={handlePreviewCsv}
                                disabled={loading}
                            >
                                Preview
                            </button>
                        </div>
                    )}
                </div>
            )}

            {loading && <p className="ledger-status">Working…</p>}
            {error && <p className="ledger-status error">{error}</p>}
            {result && <p className="ledger-status">{result}</p>}
            {csvErrors.length > 0 && (
                <p className="ledger-status error">
                    Skipped {csvErrors.length} row{csvErrors.length === 1 ? '' : 's'}: {
                        csvErrors.map((e) => `row ${e.row}: ${e.message}`).join('; ')
                    }
                </p>
            )}

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
                                    <span className="ledger-desc">
                                        {c.description}
                                        {c.isDuplicate && (
                                            <span className="import-duplicate-badge">Possible duplicate</span>
                                        )}
                                        {c.aiSuggested && (
                                            <span className="import-ai-badge">AI guess</span>
                                        )}
                                    </span>
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
                                    <SaveAsRuleButton description={c.description} categoryId={c.category_id}/>
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

- [ ] **Step 3: Add styling**

Modify `frontend/src/import/Import.css` — append:

```css
.import-format-toggle {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.import-format-button {
  font-family: var(--sans);
  font-size: 0.85rem;
  background: none;
  color: var(--text-on-ink);
  border: 1px solid var(--rule-on-ink);
  border-radius: 999px;
  padding: 0.4rem 0.9rem;
  cursor: pointer;
}

.import-format-button--active {
  background: var(--credit-dim);
  color: var(--text-on-ink-strong);
  border-color: var(--credit-dim);
}

.import-csv-mapping {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 1rem;
  margin-top: 1rem;
}

.import-csv-mapping-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-on-ink);
}

.import-csv-mapping-field select {
  font-family: var(--sans);
  font-size: 0.9rem;
  text-transform: none;
  letter-spacing: normal;
  color: var(--text-on-ink-strong);
  background: var(--ink-raised);
  border: 1px solid var(--rule-on-ink);
  border-radius: 4px;
  padding: 0.45rem 0.6rem;
  min-width: 10rem;
}
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification in the running app**

Run both dev servers, then on `/import`:

1. Click "CSV file", choose a real CSV export (e.g. a Cash App CSV export). Confirm the three column dropdowns appear, pre-selected to sensible columns (Date → a column named "Date"; Description → "Notes" if present; Amount → "Net Amount" if present, else "Amount").
2. Click "Preview". Confirm the candidate list renders exactly like a PDF import's (checkboxes, category controls, badges), that rows with amount `0.00` start unchecked, and that re-importing the same file twice flags the second batch's rows as "Possible duplicate".
3. Edit a CSV with a deliberately bad row (e.g. a blank date) and confirm the "Skipped N rows: row X: ..." message appears above the candidate list while the good rows still import normally.
4. Switch back to "PDF statement" and confirm the original PDF flow still works unchanged.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/helpers/csv.ts frontend/src/import/Import.tsx frontend/src/import/Import.css
git commit -m "Add CSV format toggle and column-mapping UI to the import page"
```

---

## Self-Review Notes

- **Spec coverage:** CSV/date/amount parsing (Task 1), row mapping with per-row errors (Task 2), backend endpoint + `buildImportCandidates` refactor + dedupe reuse (Task 3), frontend API client (Task 4), format toggle + column mapping + default zero-amount deselection + error display (Task 5). All spec sections have a corresponding task.
- **Type consistency:** `CsvColumnMapping`/`CsvRowError` (Task 2) match what Task 3's controller builds and what Task 4's frontend type/API client consume; `mapping` field names (`dateColumn`/`descriptionColumn`/`amountColumn`) are consistent across the HTTP body, `ImportApiService`, and `Import.tsx`'s state.
- **No placeholders:** every step has complete, concrete code.
