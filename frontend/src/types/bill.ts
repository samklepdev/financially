export type Bill = {
    id: number;
    name: string;
    amount_cents: number;
    due_day: number;
    match_pattern: string;
}

export type NewBill = Omit<Bill, 'id'>;

export type UpcomingBill = {
    bill: Bill;
    dueDate: string;
    status: 'paid' | 'overdue' | 'upcoming';
};

export type SuggestedBill = {
    description: string;
    amount_cents: number;
    suggested_due_day: number;
    occurrences: number;
};
