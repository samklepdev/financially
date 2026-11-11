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
