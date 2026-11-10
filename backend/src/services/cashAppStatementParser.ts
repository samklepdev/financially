import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
    groupIntoRows,
    findHeaderRowIndex,
    columnBoundsFromRow,
    bucketRow,
    isNoiseRow,
    mergeContinuations,
    type TextItem,
} from '../helpers/statementRows.ts';
import {mapRowToTransaction} from '../helpers/cashAppMapping.ts';
import type {NewTransaction} from '../types/transaction.ts';

const MONTH_YEAR = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/;

/**
 * Parses a Cash App monthly PDF account statement into candidate transactions.
 * Scans every page; a page with no transaction table (e.g. the summary or
 * legal-text pages) is silently skipped.
 *
 * @throws Error if no page in the whole document has a recognizable statement table.
 */
export async function parseCashAppStatementPdf(buffer: Buffer): Promise<NewTransaction[]> {
    // pdfjs-dist rejects a raw Node Buffer — it must be a plain Uint8Array.
    const doc = await getDocument({data: new Uint8Array(buffer)}).promise;
    const transactions: NewTransaction[] = [];

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
        const page = await doc.getPage(pageNum);
        const content = await page.getTextContent();
        const viewport = page.getViewport({scale: 1});

        const items: TextItem[] = (content.items as {str: string, transform: number[]}[])
            .map((item) => ({
                text: item.str,
                x: item.transform[4],
                // pdfjs's y increases bottom-to-top; flip it so our row
                // reconstruction's "increases top-to-bottom" assumption holds.
                y: viewport.height - item.transform[5],
            }))
            .filter((item) => item.text.trim() !== '');

        const monthYearMatch = items.map((item) => item.text.match(MONTH_YEAR)).find((m) => m);
        const rows = groupIntoRows(items);
        const headerIndex = findHeaderRowIndex(rows);

        if (!monthYearMatch || headerIndex === -1) {
            continue;
        }

        const bounds = columnBoundsFromRow(rows[headerIndex]);
        const dataRows = rows.slice(headerIndex + 1)
            .map((row) => bucketRow(row, bounds))
            .filter((row) => !isNoiseRow(row));
        const merged = mergeContinuations(dataRows);

        for (const row of merged) {
            const mapped = mapRowToTransaction(monthYearMatch[0], row);
            if (mapped) {
                transactions.push(mapped);
            }
        }
    }

    if (transactions.length === 0) {
        throw new Error('Could not find the expected statement layout in this PDF');
    }

    return transactions;
}
