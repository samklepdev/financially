import type {BillApiResult} from "../types/billApiResult.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isOptionalId = (v: unknown) => v == null || Number.isInteger(v);

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

    // Return false if deferred_until is not null or a YYYY-MM-DD string
    if (b.deferred_until !== null && (typeof b.deferred_until !== 'string' || !DATE.test(b.deferred_until))) {
        return {ok: false, error: 'deferred_until must be null or a YYYY-MM-DD date'}
    }

    // Return false if category_id is not an integer or null
    if (!isOptionalId(b.category_id)) {
        return {ok: false, error: 'category_id must be an integer or null'}
    }

    // Return false if marked_paid_for is set but not a YYYY-MM-DD string
    if (b.marked_paid_for != null && (typeof b.marked_paid_for !== 'string' || !DATE.test(b.marked_paid_for))) {
        return {ok: false, error: 'marked_paid_for must be null or a YYYY-MM-DD date'}
    }

    return {
        ok: true,
        value: {
            name: b.name,
            amount_cents: b.amount_cents as number,
            due_day: b.due_day as number,
            match_pattern: b.match_pattern,
            deferred_until: b.deferred_until as string | null,
            category_id: (b.category_id ?? null) as number | null,
            marked_paid_for: (b.marked_paid_for ?? null) as string | null,
        }
    }
}
