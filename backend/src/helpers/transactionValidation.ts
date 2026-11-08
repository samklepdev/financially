import type {ApiResult} from "../types/apiResult.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isOptionalId = (v: unknown) => v == null || Number.isInteger(v);

/**
 * @desc Validate a transaction object
 * @desc Returns an ApiResult object with either the validated transaction or an error message
 * @param body
 */
export function validateTransaction(body: unknown): ApiResult {
    // Return false if it isn't an object
    if(typeof body !== 'object' || body === null) {
        return {ok: false, error: 'Body must be a JSON Object'}
    }

    const b = body as Record<string, unknown>;

    // Return false if date is not a string or in required format
    if (typeof b.date !== 'string' || !DATE.test(b.date)) {
        return {ok: false, error: 'date must be YYYY-MM-DD'}
    }

    // Return false if description is not a string or is missing
    if (typeof b.description !== 'string' || b.description.trim() === '') {
        return {ok: false, error: 'description is required'}
    }

    // Return false if amount_cents is not a number
    if (!Number.isInteger(b.amount_cents)) {
        return { ok: false, error: 'amount_cents must be a whole number of cents'}
    }

    // Return false if category_id is not an integer or null
    if (!isOptionalId(b.category_id)) {
        return {ok: false, error: 'category_id must be an integer or null'}
    }

    // Return false if bill_id is not an integer or null
    if (!isOptionalId(b.bill_id)) {
        return {ok: false, error: 'bill_id must be an integer or null'}
    }

    return {
        ok: true,
        value: {
            date: b.date,
            description: b.description,
            amount_cents: b.amount_cents as number,
            category_id: (b.category_id ?? null) as number | null,
            bill_id: (b.bill_id ?? null) as number | null,
        }
    }
}