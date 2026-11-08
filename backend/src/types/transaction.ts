export type Transaction = {
    id: number;
    date: string;
    description: string;
    amount_cents: number;
    category_id: number | null;
    bill_id: number | null;
}

export type NewTransaction = Omit<Transaction, 'id'>;