import type {NewCategoryRule} from "./categoryRule.ts";

export type CategoryRuleApiResult =
    | { ok: true, value: NewCategoryRule }
    | { ok: false, error: string };
