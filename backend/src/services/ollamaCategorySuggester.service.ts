import type {Category} from "../types/category.ts";
import {CategoryService} from "./categories.service.ts";

const OLLAMA_URL = 'http://localhost:11434';
const OLLAMA_MODEL = 'gemma4:e4b';
// gemma4:e4b is a "thinking" model and can take 20-45s to respond on a cold
// load (loading its ~9.5GB of weights into memory after Ollama's idle
// unload); think:false below skips its reasoning trace once warm, but the
// timeout still needs enough headroom for that cold-load case.
const TIMEOUT_MS = 60_000;

const categoryService = new CategoryService();

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
        `Existing categories: ${categoryNames.join(', ')}`,
        'Transaction descriptions to categorize:',
        ...uniqueDescriptions.map((d) => `- ${d}`),
        '',
        'Respond with ONLY a JSON object. Each key must be one of the exact ' +
        'transaction descriptions listed above, verbatim. For each one: if one ' +
        'of the existing categories fits well, use that exact category name as ' +
        'the value. If none of the existing categories fit, propose a short, ' +
        'sensible new category name instead (e.g. "Pet Care", "Home Improvement"). ' +
        'If you genuinely cannot tell what the transaction is for, use null.',
    ].join('\n');
}

export type CategorySuggestion =
    | {kind: 'existing', categoryId: number}
    | {kind: 'new', name: string}
    | {kind: 'none'};

/**
 * Parses the model's JSON response into a description -> CategorySuggestion
 * map. A value matching an existing category (case-insensitively) resolves
 * to {kind: 'existing'}; any other non-empty string is treated as a
 * proposed new category name ({kind: 'new'}) rather than discarded — the
 * caller (resolveNewCategories, confirm-time only) decides whether to
 * actually create it. null, or anything that isn't a non-empty string,
 * resolves to {kind: 'none'}.
 */
export function parseOllamaResponse(raw: string, categories: Category[]): Record<string, CategorySuggestion> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {};
    }

    const result: Record<string, CategorySuggestion> = {};
    for (const [description, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value !== 'string' || value.trim() === '') {
            result[description] = {kind: 'none'};
            continue;
        }
        const match = categories.find((c) => c.name.toLowerCase() === value.toLowerCase());
        result[description] = match
            ? {kind: 'existing', categoryId: match.id}
            : {kind: 'new', name: value.trim()};
    }
    return result;
}

/**
 * Asks the local Ollama model to guess a category for each description that
 * neither exact-history nor keyword-rule matching could resolve. Entirely
 * best-effort: any failure (Ollama not running, timeout, a bad or malformed
 * response) resolves to an empty map rather than throwing, so import keeps
 * working exactly as it does without this layer.
 */
export async function suggestCategories(descriptions: string[]): Promise<Record<string, CategorySuggestion>> {
    if (descriptions.length === 0) {
        return {};
    }

    const categories = categoryService.getAllCategories();
    if (categories.length === 0) {
        return {};
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                format: 'json',
                stream: false,
                think: false,
                messages: [{role: 'user', content: buildOllamaPrompt(descriptions, categories)}],
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            return {};
        }

        const body = await response.json() as {message?: {content?: string}};
        if (!body.message?.content) {
            return {};
        }

        return parseOllamaResponse(body.message.content, categories);
    } catch {
        return {};
    } finally {
        clearTimeout(timeout);
    }
}
