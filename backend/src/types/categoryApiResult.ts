import type {NewCategory} from "./category.ts";

export type CategoryApiResult =
    | { ok: true, value: NewCategory }
    | { ok: false, error: string };
