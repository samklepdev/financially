# Financially

A personal finance tracker that runs entirely on your own machine. Track expenses, categorise them by hand or by importing a bank spreadsheet, see where the money goes in charts, and keep an eye on upcoming bills.

Your data never leaves your computer: no cloud, no accounts, no bank logins. Everything is stored in a local SQLite file.

> **Status:** work in progress. Transactions, categories, PDF import with auto-categorization, charts, and an AI chat sidebar are done; bills, budgets, and multi-account support are next. See the [roadmap](#roadmap).

## Tech stack

| Part | Choice |
|---|---|
| Runtime | Node.js 26+ (runs TypeScript directly, no build step) |
| API | Express 5 |
| Database | SQLite through Node's built-in `node:sqlite` |
| Language | TypeScript (strict) |
| Frontend | React + Vite (TypeScript) |

## Getting started

Requires **Node.js 26 or newer** (`node --version`).

```bash
# Install dependencies
npm install

# Start the API (restarts on save)
cd backend
node --watch src/app.ts
```

The API runs at `http://localhost:3000`. Set `PORT` to use another port.

The database file `financially.db` is created automatically on the first start, with all tables.

Frontend (in a second terminal):

```bash
cd frontend
npm install
npm run dev
```

The app runs at `http://localhost:5173`.

Type-check the backend without running it:

```bash
cd backend
npx tsc --noEmit
```

## Project structure

```
backend/
  src/
    app.ts              Express app: middleware, routes, listen
    config/db.ts        Opens the SQLite database and creates the tables
    routes/             URL → controller mapping
    controllers/        HTTP layer: reads the request, sends status codes and JSON
    services/           Database queries and business logic (no Express here)
    helpers/            Input validation
    types/              Shared TypeScript types
frontend/               React + Vite app
```

## API

Base URL: `/api/v1`. Successful responses are `{ "data": ... }`; errors are `{ "error": "message" }`.

### Transactions

| Method | Path | Description | Success |
|---|---|---|---|
| `GET` | `/transactions` | List all, newest first | `200` |
| `GET` | `/transactions/:id` | Get one | `200` |
| `POST` | `/transactions` | Create | `201` |
| `PUT` | `/transactions/:id` | Replace (send every field) | `200` |
| `DELETE` | `/transactions/:id` | Delete | `204` |

Errors: `400` for invalid input or a category/bill that doesn't exist, `404` when the id doesn't exist.

Request body for `POST` and `PUT`:

```json
{
  "date": "2026-11-08",
  "description": "Coffee",
  "amount_cents": 450,
  "category_id": null,
  "bill_id": null
}
```

| Field | Rule |
|---|---|
| `date` | Required, `YYYY-MM-DD` |
| `description` | Required, non-empty text |
| `amount_cents` | Required, whole number of cents (`450` = $4.50) |
| `category_id` | Optional, id of an existing category, or `null` |
| `bill_id` | Optional, id of an existing bill, or `null` |

Example:

```bash
curl -X POST localhost:3000/api/v1/transactions \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-11-08","description":"Coffee","amount_cents":450}'
```

## Data model

| Table | Columns |
|---|---|
| `categories` | `id`, `name` (unique) |
| `bills` | `id`, `name`, `amount_cents`, `due_day` (1–31, repeats monthly) |
| `transactions` | `id`, `date`, `description`, `amount_cents`, `category_id` → categories, `bill_id` → bills |

Design choices:

- **Money is stored as whole cents** (`INTEGER`), never as decimals, so totals never pick up rounding errors.
- **Tables are `STRICT`**, so SQLite enforces column types.
- **Foreign keys are on**, and deleting a category or bill keeps its transactions (the link is set to `null`).
- **Bills store a day of the month**, not a date; the next due date is worked out from it.

## Roadmap

- [x] Database schema
- [x] Transactions API (create, read, update, delete)
- [x] React page: add and list transactions
- [x] Categories API
- [x] PDF import (Cash App statements), with auto-categorization
- [x] Auto-categorise rules (e.g. "HEB" → Groceries)
- [x] Spending totals by category and by month
- [x] Charts
- [x] Tests with `node:test`
- [ ] Bills API (schema exists, no service/controller/routes/UI yet)
- [ ] Recurring bills/subscriptions tracking (detect + manage recurring transactions, upcoming bills widget)
- [ ] Budgets per category (monthly caps, progress/alerts)
- [ ] Multi-account support (tag transactions by source account)
- [ ] Search/filter on the transactions page (date range, category, amount, text)
- [ ] CSV export of transactions/categories
- [ ] Recurring/scheduled manual transactions (projected future balance)
- [ ] More import sources beyond Cash App PDF (bank CSV, other PDF formats)
- [ ] Rule management UX polish (bulk edit/merge, preview impact before saving)
- [ ] Extend AI chat (spending pattern Q&A over a date range)

## Privacy

The database (`*.db`) and any bank exports (`*.csv`) are git-ignored and must never be committed.
