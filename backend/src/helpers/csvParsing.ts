const ISO_PREFIX = /^(\d{4}-\d{2}-\d{2})/;
const US_SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/;

/**
 * Parses CSV text into rows of raw string fields (row 0 is the header row).
 * A small RFC4180-ish parser: handles quoted fields (which may contain
 * commas or newlines) and doubled `""` as an escaped quote inside a quoted
 * field. Trailing blank rows (e.g. from a trailing newline) are dropped.
 */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    let i = 0;

    function endField() {
        row.push(field);
        field = '';
    }

    function endRow() {
        endField();
        rows.push(row);
        row = [];
    }

    while (i < text.length) {
        const char = text[i];

        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i++;
                continue;
            }
            field += char;
            i++;
            continue;
        }

        if (char === '"') {
            inQuotes = true;
            i++;
        } else if (char === ',') {
            endField();
            i++;
        } else if (char === '\r') {
            i++;
        } else if (char === '\n') {
            endRow();
            i++;
        } else {
            field += char;
            i++;
        }
    }

    if (field !== '' || row.length > 0) {
        endRow();
    }

    return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/**
 * Parses a date column value into YYYY-MM-DD. Recognizes a leading ISO date
 * (optionally followed by a time and/or timezone, e.g.
 * "2026-11-11 16:42:35 CST" — the time/timezone is intentionally ignored,
 * since a statement date is a wall-clock calendar date, not an instant, and
 * converting it would risk the kind of off-by-one timezone bug already hit
 * elsewhere in this project's date-range math) and MM/DD/YYYY.
 *
 * @throws Error if the value matches neither recognized format.
 */
export function parseGenericDate(raw: string): string {
    const trimmed = raw.trim();

    const isoMatch = trimmed.match(ISO_PREFIX);
    if (isoMatch) {
        return isoMatch[1];
    }

    const slashMatch = trimmed.match(US_SLASH);
    if (slashMatch) {
        const [, month, day, year] = slashMatch;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    throw new Error(`Could not parse date: "${raw}"`);
}

/**
 * Parses an amount column value into integer cents. Strips `$`, thousands
 * commas, and whitespace; a value wrapped in parentheses or with a leading
 * `-` is treated as negative.
 *
 * @throws Error if no digits remain after stripping formatting characters.
 */
export function parseGenericAmount(raw: string): number {
    const trimmed = raw.trim();
    const isParenNegative = /^\(.*\)$/.test(trimmed);
    const stripped = trimmed.replace(/[()$,\s]/g, '');
    const isNegative = isParenNegative || stripped.startsWith('-');
    const digits = stripped.replace(/^-/, '');

    if (digits === '' || !/^\d+(\.\d+)?$/.test(digits)) {
        throw new Error(`Could not parse amount: "${raw}"`);
    }

    const value = Number(digits);
    return Math.round(value * 100) * (isNegative ? -1 : 1);
}
