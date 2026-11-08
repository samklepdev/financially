import type {NewTransaction, Transaction} from "./transaction.ts";

export type ApiResult =
    | { ok: true, value: Transaction | NewTransaction }
    | { ok: false, error: string };