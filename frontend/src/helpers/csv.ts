export function parseCsvHeaderRow(text: string): string[] {
    const firstLine = text.split(/\r\n|\n/, 1)[0] ?? '';
    const headers: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < firstLine.length; i++) {
        const char = firstLine[i];
        if (inQuotes) {
            if (char === '"') {
                if (firstLine[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
            continue;
        }
        if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            headers.push(field);
            field = '';
        } else {
            field += char;
        }
    }
    headers.push(field);

    return headers;
}

export function guessDateColumn(headers: string[]): string {
    return headers.find((h) => h.toLowerCase().includes('date')) ?? headers[0] ?? '';
}

export function guessDescriptionColumn(headers: string[]): string {
    const keywords = ['description', 'desc', 'notes', 'memo'];
    return headers.find((h) => keywords.some((k) => h.toLowerCase().includes(k))) ?? headers[0] ?? '';
}

export function guessAmountColumn(headers: string[]): string {
    const netAmount = headers.find((h) => {
        const lower = h.toLowerCase();
        return lower.includes('net') && lower.includes('amount');
    });
    if (netAmount) {
        return netAmount;
    }
    return headers.find((h) => h.toLowerCase().includes('amount')) ?? headers[0] ?? '';
}
