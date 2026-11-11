import type {Category} from "../types/category.ts";

/**
 * Builds the prompt sent to the local Ollama model, listing the user's
 * existing categories and the (deduplicated) transaction descriptions that
 * still need a category guessed, after exact-history and keyword-rule
 * matching already came up empty for them.
 */
export function buildOllamaPrompt(descriptions: string[], categories: Category[]): string {
    const uniqueDescriptions = [...new Set(descriptions)];
    const categoryNames = categories.map((c) => c.name);

    return [
        'You are categorizing personal bank transactions for a budgeting app.',
        `Allowed categories (choose only from this exact list): ${categoryNames.join(', ')}`,
        'Transaction descriptions to categorize:',
        ...uniqueDescriptions.map((d) => `- ${d}`),
        '',
        'Respond with ONLY a JSON object. Each key must be one of the exact ' +
        'transaction descriptions listed above, verbatim. Each value must be ' +
        'exactly one of the allowed category names, or null if none of them ' +
        'fit well. Do not invent category names that are not in the list.',
    ].join('\n');
}

/**
 * Parses the model's JSON response into a description -> category_id map.
 * Any value that isn't an exact (case-insensitive) match for one of the
 * user's real categories resolves to null rather than throwing — this is a
 * best-effort suggestion, not a trusted data source, so a hallucinated or
 * malformed answer degrades to "no suggestion" instead of corrupting data.
 */
export function parseOllamaResponse(raw: string, categories: Category[]): Record<string, number | null> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {};
    }

    const result: Record<string, number | null> = {};
    for (const [description, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value !== 'string') {
            result[description] = null;
            continue;
        }
        const match = categories.find((c) => c.name.toLowerCase() === value.toLowerCase());
        result[description] = match?.id ?? null;
    }
    return result;
}
