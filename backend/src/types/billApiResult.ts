import type {NewBill} from "./bill.ts";

export type BillApiResult =
    | { ok: true, value: NewBill }
    | { ok: false, error: string };
