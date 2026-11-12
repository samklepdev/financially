# Defer a bill's next occurrence — design

**Status:** approved, ready for implementation plan
**Context:** [[2026-11-11-recurring-bills-design]] shipped recurring bills on a
fixed monthly `due_day`. That model can't represent a real-world one-off
deferral — e.g. a lender pushing a car note payment back one cycle — without
permanently changing `due_day`, which would then be wrong again next month.
Confirmed with the user after they saw the dashboard's "Upcoming Bills"
widget report a due date that was correct for the bill's normal schedule but
wrong for this one deferred cycle. This project adds a one-time override for
a bill's next occurrence, without touching its permanent recurring day.

## Data model

Additive column on `bills`, guarded the same way `match_pattern` was added
in the recurring-bills project:

```sql
-- bills.deferred_until TEXT (nullable, YYYY-MM-DD), guarded ALTER
```

- `null` (default, and always the value on a newly-created bill): no
  deferral in effect — the bill follows its recurring `due_day` as before.
- A `YYYY-MM-DD` string: overrides the due date for the *next* occurrence
  only. This date is picked freely by the user (not constrained to land on
  `due_day`), so it can represent any one-off adjustment, not just a
  one-month push.
- **Self-clearing, not self-renewing.** Once "today" passes
  `deferred_until`, the override is spent: it's cleared (set back to
  `null`) the next time `getUpcomingBills` runs, and the bill resumes
  computing its due date from `due_day` for every cycle after that,
  automatically. There is no "defer N cycles" concept — deferring again
  requires setting `deferred_until` again.

## Backend

- `helpers/billValidation.ts`: `validateBill` gains `deferred_until`,
  accepting `null` or a string matching the existing date format used
  elsewhere in this codebase (`/^\d{4}-\d{2}-\d{2}$/`, same regex as
  `transactionValidation.ts`). No "must be in the future" check — a
  `deferred_until` dated in the past is harmless (the next
  `getUpcomingBills` call clears it as expired, same as any other expired
  deferral), so validating against "today" here would only add a
  today-dependent code path for no behavioral benefit.
- `types/bill.ts`: `Bill`/`NewBill` gain `deferred_until: string | null`.
- `services/bill.service.ts`, `getUpcomingBills`: for each bill, after
  computing the normal `dueDate`/`nextDueDate` from `due_day` exactly as
  today —
  - If `bill.deferred_until` is non-null and `> todayISO`: override
    `dueDate` to `deferred_until`, and recompute `nextDueDate` as one
    `due_day`-cadence cycle after the (parsed) `deferred_until` month,
    using the same `dueDateForMonth` helper already in this file. The rest
    of the function — the `daysUntilDue`/14-day-inclusion check, the
    grace-window paid-detection query, and the `paid`/`overdue`/`upcoming`
    status derivation — runs completely unchanged against these overridden
    dates. No new branching in that logic; only the two input dates change.
  - If `bill.deferred_until` is non-null and `<= todayISO` (expired):
    issue `UPDATE bills SET deferred_until = NULL WHERE id = ?` for that
    bill, then fall through to the normal (non-deferred) computation for
    this and every future call. This lazy-clear-on-read is the only place
    `deferred_until` ever gets reset — there's no separate sweep/cron job.
  - If `bill.deferred_until` is null: unchanged from today's behavior.
- `controllers/bill.controller.ts` / the existing `updateBill` handler:
  no new endpoint. `deferred_until` is just one more field accepted (and
  required, like the others) on the existing `PUT /bills/:id` body,
  validated by the updated `validateBill`. Setting it to `null` via a
  normal update is how a deferral gets cleared.

## Frontend

- `types/bill.ts`: `Bill`/`NewBill` gain `deferred_until: string | null`.
  The add-bill form in `Bills.tsx` always sends `deferred_until: null` on
  creation — deferring only ever applies to a bill that already exists.
- `BillRow.tsx`: a new small control, placed after the existing four
  fields (name/amount/due day/match pattern) and before the Delete button:
  - When `bill.deferred_until` is `null`: a "Defer" button. Clicking it
    reveals an `<input type="date">` plus "Confirm"/"Cancel" buttons (local
    component state only, not committed until Confirm). Confirming calls
    the existing `onUpdate` with every other field unchanged and
    `deferred_until` set to the picked date — same full-snapshot-on-commit
    pattern `BillRow` already uses for its other fields, for the same
    out-of-order-response reason documented in that file. Canceling just
    hides the date input again, no API call.
  - When `bill.deferred_until` is set: instead of the "Defer" button, show
    the deferred date as plain text (e.g. `Deferred to 2026-12-18`) next to
    a "Clear" button. Clicking "Clear" calls `onUpdate` with
    `deferred_until: null` and every other field unchanged.
- **No changes to `UpcomingBills.tsx` or its CSS.** The dashboard widget
  already renders whatever `dueDate`/`status` `GET /bills/upcoming`
  returns; since the backend fix produces the correct overridden date
  under the same field names, the widget needs no awareness that a
  deferral even exists.

## Testing

- Backend: extend `bill.service.test.ts` —
  - `getUpcomingBills` returns the deferred date (not the `due_day`-computed
    one) as `dueDate` when `deferred_until` is set and still in the future.
  - A transaction dated within the grace window around `deferred_until`
    (not around the original `due_day` date) is correctly detected as
    `paid` — proves the override also redirects the payment-window check,
    not just the displayed date.
  - A transaction dated around the *original* `due_day` date (not
    `deferred_until`) is correctly NOT detected as paid while a deferral is
    active — proves the override fully replaces the window rather than
    checking both.
  - When `deferred_until` is in the past relative to "today" (an expired
    deferral), `getUpcomingBills` returns the normal `due_day`-computed
    date, and a follow-up `getBillById` confirms `deferred_until` was
    cleared to `null` in the database.
  - `validateBill` accepts `null` and a valid `YYYY-MM-DD` string for
    `deferred_until`, and rejects a malformed string.
  - HTTP-level: `PUT /bills/:id` accepts and persists a `deferred_until`
    update, and accepts clearing it back to `null`.
- Frontend: `npx tsc -b --noEmit` plus manual verification — defer a bill to
  a future date, confirm the dashboard widget shows the deferred date
  instead of the original; clear the deferral and confirm it reverts.

## Out of scope

- Deferring more than one upcoming occurrence at a time (explicitly
  decided against — one-time-only per the approved design).
- A "Defer" action anywhere other than the `/bills` page (e.g. not added to
  the dashboard widget).
- Constraining the picked date to any particular range (e.g. disallowing a
  date far in the past) — the self-clearing behavior on an expired date
  makes this unnecessary to guard against.
