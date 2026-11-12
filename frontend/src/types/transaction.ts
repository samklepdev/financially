export type Transaction = {
    id: number;
    date: string;
    description: string;
    amount_cents: number;
    category_id: number | null;
    bill_id: number | null;
}

export type NewTransaction = Omit<Transaction, 'id'>;

export type ImportCandidate = NewTransaction & {
    isDuplicate: boolean;
    aiSuggested: boolean;
    proposedCategoryName: string | null;
};

export type ImportConfirmItem = NewTransaction & {newCategoryName?: string};

export type CategorySuggestion = {
    category_id: number | null;
    bill_id: number | null;
    aiSuggested: boolean;
    proposedCategoryName: string | null;
};

export type CsvRowError = {row: number, message: string};