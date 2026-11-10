export type TextItem = {text: string, x: number, y: number};
export type ColumnName = 'date' | 'description' | 'details' | 'fee' | 'amount';
export type ColumnBounds = Record<ColumnName, number>;
export type BucketedRow = Record<ColumnName, string>;

const ROW_TOLERANCE = 3;

const HEADER_LABELS: Record<ColumnName, string> = {
    date: 'Date',
    description: 'Description',
    details: 'Details',
    fee: 'Fee',
    amount: 'Amount',
};

/**
 * Groups text items into visual rows by y-position. Assumes y increases
 * top-to-bottom. Items within ROW_TOLERANCE of a row's first item's y are
 * treated as the same row (compared to the row's first item, not the last
 * one added, to avoid cumulative drift across a wide row).
 */
export function groupIntoRows(items: TextItem[]): TextItem[][] {
    const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
    const rows: TextItem[][] = [];

    for (const item of sorted) {
        const lastRow = rows.at(-1);
        const rowY = lastRow?.[0]?.y;
        if (lastRow && rowY !== undefined && Math.abs(item.y - rowY) <= ROW_TOLERANCE) {
            lastRow.push(item);
        } else {
            rows.push([item]);
        }
    }

    return rows;
}

/**
 * Finds the row that contains all five column header labels.
 *
 * @return The row's index, or -1 if no such row exists.
 */
export function findHeaderRowIndex(rows: TextItem[][]): number {
    const labels = Object.values(HEADER_LABELS);
    return rows.findIndex((row) => {
        const texts = new Set(row.map((item) => item.text));
        return labels.every((label) => texts.has(label));
    });
}

/**
 * Reads each column's x-position from the header row.
 *
 * @throws Error if the row is missing one of the expected labels.
 */
export function columnBoundsFromRow(row: TextItem[]): ColumnBounds {
    const byText = new Map(row.map((item) => [item.text, item.x]));
    const bounds = {} as ColumnBounds;

    for (const [column, label] of Object.entries(HEADER_LABELS) as [ColumnName, string][]) {
        const x = byText.get(label);
        if (x === undefined) {
            throw new Error(`Header row is missing the "${label}" column`);
        }
        bounds[column] = x;
    }

    return bounds;
}

/**
 * Column boundaries as midpoints between adjacent header x-positions, not
 * the header positions themselves: Fee/Amount are right-aligned numeric
 * columns whose values sit to the left of their own header label, so using
 * the header's own x as a lower bound would misbucket them.
 */
function columnStarts(bounds: ColumnBounds): {name: ColumnName, start: number}[] {
    const entries = (Object.entries(bounds) as [ColumnName, number][]).sort((a, b) => a[1] - b[1]);
    const starts: {name: ColumnName, start: number}[] = [{name: entries[0][0], start: -Infinity}];

    for (let i = 1; i < entries.length; i++) {
        const midpoint = (entries[i - 1][1] + entries[i][1]) / 2;
        starts.push({name: entries[i][0], start: midpoint});
    }

    return starts;
}

function columnFor(x: number, bounds: ColumnBounds): ColumnName {
    const starts = columnStarts(bounds);
    let column = starts[0].name;

    for (const entry of starts) {
        if (x >= entry.start) {
            column = entry.name;
        }
    }

    return column;
}

/**
 * Buckets a row's text items into columns by x-position, using midpoint
 * boundaries derived from the header row.
 */
export function bucketRow(items: TextItem[], bounds: ColumnBounds): BucketedRow {
    const buckets: Record<ColumnName, string[]> = {date: [], description: [], details: [], fee: [], amount: []};

    for (const item of [...items].sort((a, b) => a.x - b.x)) {
        buckets[columnFor(item.x, bounds)].push(item.text);
    }

    const row = {} as BucketedRow;
    for (const column of Object.keys(buckets) as ColumnName[]) {
        row[column] = buckets[column].join(' ').replace(/\s+/g, ' ').trim();
    }

    return row;
}

/**
 * A row with nothing in date, description, or details — page furniture like
 * a page-number footer, not real table content.
 */
export function isNoiseRow(row: BucketedRow): boolean {
    return row.date === '' && row.description === '' && row.details === '';
}

/**
 * A row with no date, fee, or amount — a wrapped second line of a long
 * Description or Details value, to be merged into the previous row.
 */
export function isContinuationRow(row: BucketedRow): boolean {
    return row.date === '' && row.fee === '' && row.amount === '';
}

/**
 * Merges each continuation row's description/details into the previous row.
 * A continuation-shaped row with nothing before it (merged is still empty)
 * is kept as its own row rather than dropped.
 */
export function mergeContinuations(rows: BucketedRow[]): BucketedRow[] {
    const merged: BucketedRow[] = [];

    for (const row of rows) {
        if (isContinuationRow(row) && merged.length > 0) {
            const previous = merged.at(-1)!;
            previous.description = [previous.description, row.description].filter(Boolean).join(' ');
            previous.details = [previous.details, row.details].filter(Boolean).join(' ');
        } else {
            merged.push({...row});
        }
    }

    return merged;
}
