import {CategoryService} from "./categories.service.ts";
import {CategoryRuleService} from "./categoryRules.service.ts";
import type {NewTransaction} from "../types/transaction.ts";

const COLOR_PALETTE = [
    '#6b9478', '#c06c52', '#c99a3c', '#6c8ebf', '#a65d8f', '#4f9d8f', '#b2622d', '#7a7a9d',
];

export type ImportConfirmItem = NewTransaction & {newCategoryName?: string | null};

const categoryService = new CategoryService();
const categoryRuleService = new CategoryRuleService();

/**
 * Resolves any `newCategoryName` proposed on an import-confirm batch into a
 * real category_id. Creates the category (with an auto-assigned color) and
 * always a matching keyword rule for that row's description, at most once
 * per distinct normalized name per batch — reusing an existing category
 * when the name matches one case-insensitively, and reusing an
 * already-resolved-this-batch category when multiple rows propose the same
 * new name. Rows without `newCategoryName`, or with `category_id` already
 * set, pass through unchanged. Must only be called after the batch has
 * already passed full validation — it has DB side effects.
 */
export function resolveNewCategories(items: ImportConfirmItem[]): NewTransaction[] {
    const resolvedByNormalizedName = new Map<string, number>();

    return items.map(({newCategoryName, ...t}) => {
        if (t.category_id !== null) {
            return t;
        }
        if (!newCategoryName || newCategoryName.trim() === '') {
            return t;
        }

        const normalized = newCategoryName.trim().toLowerCase();
        let categoryId = resolvedByNormalizedName.get(normalized);

        if (categoryId === undefined) {
            const existing = categoryService.getAllCategories().find((c) => c.name.toLowerCase() === normalized);
            if (existing) {
                categoryId = existing.id;
            } else {
                const color = COLOR_PALETTE[categoryService.getAllCategories().length % COLOR_PALETTE.length];
                categoryId = categoryService.createCategory({name: newCategoryName.trim(), color}).id;
            }
            resolvedByNormalizedName.set(normalized, categoryId);
        }

        categoryRuleService.createCategoryRule({pattern: t.description, category_id: categoryId});

        return {...t, category_id: categoryId};
    });
}
