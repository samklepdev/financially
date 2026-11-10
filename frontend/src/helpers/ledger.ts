const MONTH_LABEL = new Intl.DateTimeFormat('en-US', {month: 'long', year: 'numeric'});

export function monthKey(date: string): string {
    return date.slice(0, 7);
}

export function monthLabel(key: string): string {
    const [year, month] = key.split('-').map(Number);
    return MONTH_LABEL.format(new Date(year, month - 1, 1));
}

export function shiftMonth(key: string, delta: number): string {
    const [year, month] = key.split('-').map(Number);
    const next = new Date(year, month - 1 + delta, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

export function categoryLabel(categoryId: number | null): string {
    return categoryId === null ? 'Uncategorized' : `Cat #${categoryId}`;
}
