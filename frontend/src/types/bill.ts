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

export type UpcomingBill = {
    bill: Bill;
    dueDate: string;
    status: 'paid' | 'overdue' | 'upcoming';
    markedPaid: boolean;
};

export type SuggestedBill = {
    description: string;
    amount_cents: number;
    suggested_due_day: number;
    occurrences: number;
};
