import {parseGenericDate, parseGenericAmount} from '../helpers/csvParsing.ts';
import type {NewTransaction} from '../types/transaction.ts';

export type CsvColumnMapping = {date: string, description: string, amount: string};
export type CsvRowError = {row: number, message: string};

/**
 * Maps raw CSV rows into transactions using the given column-name mapping.
 * A row whose mapped date/amount can't be parsed, or whose mapped
 * description is empty, is skipped and recorded in `errors` (1-indexed by
 * the row's position in `rows`, i.e. row 1 is the first data row after the
 * header) rather than throwing — the rest of the file still processes.
 *
 * Assumes every column name in `mapping` is present in `headers`; the
 * caller is responsible for validating that first.
 */
export function mapCsvToTransactions(
    headers: string[], rows: string[][], mapping: CsvColumnMapping
): {transactions: NewTransaction[], errors: CsvRowError[]} {
    const dateIndex = headers.indexOf(mapping.date);
    const descriptionIndex = headers.indexOf(mapping.description);
    const amountIndex = headers.indexOf(mapping.amount);

    const transactions: NewTransaction[] = [];
    const errors: CsvRowError[] = [];

    rows.forEach((row, i) => {
        const rowNumber = i + 1;
        try {
            const date = parseGenericDate(row[dateIndex] ?? '');
            const description = (row[descriptionIndex] ?? '').trim();
            if (description === '') {
                throw new Error('Description is empty');
            }
            const amount_cents = parseGenericAmount(row[amountIndex] ?? '');
            transactions.push({date, description, amount_cents, category_id: null, bill_id: null});
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Could not parse this row';
            errors.push({row: rowNumber, message});
        }
    });

    return {transactions, errors};
}
