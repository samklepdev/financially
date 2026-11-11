import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword} from '../helpers/password.ts';
import {listen} from '../testHelpers/httpServer.ts';

process.env.DATABASE_FILE = ':memory:';
process.env.APP_PASSWORD_HASH = hashPassword('test-password');

const {default: app} = await import('../app.ts');

async function loginCookie(url: string): Promise<string> {
    const res = await fetch(`${url}/api/v1/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({password: 'test-password'}),
    });
    return res.headers.get('set-cookie')!.split(';')[0];
}

function csvFormData(
    csv: string, mapping: {dateColumn: string, descriptionColumn: string, amountColumn: string}
): FormData {
    const formData = new FormData();
    formData.append('file', new Blob([csv], {type: 'text/csv'}), 'statement.csv');
    formData.append('dateColumn', mapping.dateColumn);
    formData.append('descriptionColumn', mapping.descriptionColumn);
    formData.append('amountColumn', mapping.amountColumn);
    return formData;
}

test('the csv preview endpoint requires authentication', async () => {
    const {url, close} = await listen(app);
    try {
        const res = await fetch(`${url}/api/v1/transactions/import/csv/preview`, {
            method: 'POST',
            body: csvFormData('Date,Notes,Amount\n2026-01-01,Coffee,-5.00\n', {
                dateColumn: 'Date', descriptionColumn: 'Notes', amountColumn: 'Amount',
            }),
        });
        assert.equal(res.status, 401);
    } finally {
        await close();
    }
});

test('rejects a request missing a column mapping field', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const formData = new FormData();
        formData.append('file', new Blob(['Date,Notes,Amount\n'], {type: 'text/csv'}), 'statement.csv');
        formData.append('dateColumn', 'Date');
        const res = await fetch(`${url}/api/v1/transactions/import/csv/preview`, {
            method: 'POST',
            headers: {Cookie: cookie},
            body: formData,
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('rejects an unknown column name', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const res = await fetch(`${url}/api/v1/transactions/import/csv/preview`, {
            method: 'POST',
            headers: {Cookie: cookie},
            body: csvFormData('Date,Notes,Amount\n2026-01-01,Coffee,-5.00\n', {
                dateColumn: 'Date', descriptionColumn: 'Notes', amountColumn: 'NotAColumn',
            }),
        });
        assert.equal(res.status, 400);
    } finally {
        await close();
    }
});

test('returns candidates for good rows and errors for bad rows', async () => {
    const {url, close} = await listen(app);
    try {
        const cookie = await loginCookie(url);
        const csv = 'Date,Notes,Amount\n'
            + '2026-01-01,Coffee Shop CSV Test,-5.00\n'
            + 'not a date,Bad Row,-1.00\n';
        const res = await fetch(`${url}/api/v1/transactions/import/csv/preview`, {
            method: 'POST',
            headers: {Cookie: cookie},
            body: csvFormData(csv, {dateColumn: 'Date', descriptionColumn: 'Notes', amountColumn: 'Amount'}),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.data.transactions.length, 1);
        assert.equal(body.data.transactions[0].description, 'Coffee Shop CSV Test');
        assert.equal(body.data.errors.length, 1);
        assert.equal(body.data.errors[0].row, 2);
    } finally {
        await close();
    }
});
