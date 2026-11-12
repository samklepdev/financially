export type Bill = {
    id: number;
    name: string;
    amount_cents: number;
    due_day: number;
    match_pattern: string;
    deferred_until: string | null;
    category_id: number | null;
    marked_paid_for: string | null;
}

export type NewBill = Omit<Bill, 'id'>;
