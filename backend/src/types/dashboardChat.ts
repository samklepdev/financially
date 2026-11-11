export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatMessage = {
    role: ChatRole;
    content: string;
};

export type DashboardRange = '30d' | '90d' | '1y' | 'all';

export type ChatRequestBody = {
    messages: ChatMessage[];
    range: DashboardRange;
};

export type CategorySpend = {
    name: string;
    totalCents: number;
};

export type FinancialSummary = {
    totalInCents: number;
    totalOutCents: number;
    netCents: number;
    topCategories: CategorySpend[];
};
