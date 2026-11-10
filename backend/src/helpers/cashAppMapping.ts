import type {BucketedRow} from './statementRows.ts';
import type {NewTransaction} from '../types/transaction.ts';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_MONTHS = MONTH_NAMES.map((m) => m.slice(0, 3));

/**
 * Combines a page's "September 2026" header with a row's "Sep 5" date.
 *
 * @throws Error if either string can't be parsed, or the row's month doesn't
 * match the statement's month.
 */
export function reconstructDate(monthYear: string, shortDate: string): string {
    const monthYearMatch = monthYear.match(/^(\w+)\s+(\d{4})$/);
    if (!monthYearMatch) {
        throw new Error(`Could not parse statement month/year: "${monthYear}"`);
    }
    const [, monthName, year] = monthYearMatch;
    const monthIndex = MONTH_NAMES.indexOf(monthName);
    if (monthIndex === -1) {
        throw new Error(`Unknown month name: "${monthName}"`);
    }

    const dateMatch = shortDate.match(/^(\w{3})\s+(\d{1,2})$/);
    if (!dateMatch) {
        throw new Error(`Could not parse row date: "${shortDate}"`);
    }
    const [, shortMonth, day] = dateMatch;
    if (SHORT_MONTHS[monthIndex] !== shortMonth) {
        throw new Error(`Row date "${shortDate}" doesn't match statement month "${monthYear}"`);
    }

    return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function parseDollars(text: string): number {
    return Number(text.replace(/[^0-9.]/g, ''));
}

/**
 * Folds a row's Fee into its signed Amount.
 *
 * @param amountText e.g. "+ $100.00" (credit) or "$16.88" (debit, no sign).
 * @param feeText e.g. "$1.00". Always a positive cost.
 * @return amount_cents = round((signedAmount - fee) * 100).
 */
export function computeAmountCents(amountText: string, feeText: string): number {
    const isCredit = amountText.trim().startsWith('+');
    const amount = parseDollars(amountText);
    const fee = parseDollars(feeText || '$0.00');
    const signedAmount = isCredit ? amount : -amount;
    return Math.round((signedAmount - fee) * 100);
}

/**
 * Combines the Description and Details columns into one field.
 */
export function buildDescription(description: string, details: string): string {
    return details ? `${description} (${details})` : description;
}

/**
 * A canceled transaction has zero real financial effect.
 */
export function isCanceled(details: string): boolean {
    return details.includes('(canceled)');
}

/**
 * Maps one reconstructed statement row to a transaction ready to insert.
 *
 * @return null if the row is a canceled transaction (should be skipped).
 */
export function mapRowToTransaction(monthYear: string, row: BucketedRow): NewTransaction | null {
    if (isCanceled(row.details)) {
        return null;
    }

    return {
        date: reconstructDate(monthYear, row.date),
        description: buildDescription(row.description, row.details),
        amount_cents: computeAmountCents(row.amount, row.fee),
        category_id: null,
        bill_id: null,
    };
}
