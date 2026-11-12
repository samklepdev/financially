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
