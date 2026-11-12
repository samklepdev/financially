export type Bill = {
    id: number;
    name: string;
    amount_cents: number;
    due_day: number;
    match_pattern: string;
}

export type NewBill = Omit<Bill, 'id'>;
