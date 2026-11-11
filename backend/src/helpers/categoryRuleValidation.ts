import type {CategoryRuleApiResult} from "../types/categoryRuleApiResult.ts";

/**
 * @desc Validate a category rule object
 * @desc Returns a CategoryRuleApiResult with either the validated rule or an error message
 * @param body
 */
export function validateCategoryRule(body: unknown): CategoryRuleApiResult {
    // Return false if it isn't an object
    if (typeof body !== 'object' || body === null) {
        return {ok: false, error: 'Body must be a JSON Object'}
    }

    const b = body as Record<string, unknown>;

    // Return false if pattern is not a string or is missing
    if (typeof b.pattern !== 'string' || b.pattern.trim() === '') {
        return {ok: false, error: 'pattern is required'}
    }

    // Return false if category_id is not an integer
    if (!Number.isInteger(b.category_id)) {
        return {ok: false, error: 'category_id must be an integer'}
    }

    return {
        ok: true,
        value: {
            pattern: b.pattern,
            category_id: b.category_id as number,
        }
    }
}
