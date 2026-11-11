import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv, parseGenericDate, parseGenericAmount} from './csvParsing.ts';

test('parseCsv splits a simple CSV into header and rows', () => {
    const result = parseCsv('Date,Amount\n2026-01-01,10.00\n2026-01-02,20.00\n');
    assert.deepEqual(result, [
        ['Date', 'Amount'],
        ['2026-01-01', '10.00'],
        ['2026-01-02', '20.00'],
    ]);
});

test('parseCsv handles quoted fields with embedded commas', () => {
    const result = parseCsv('"Date","Notes"\n"2026-01-01","Hello, world"\n');
    assert.deepEqual(result, [
        ['Date', 'Notes'],
        ['2026-01-01', 'Hello, world'],
    ]);
});

test('parseCsv un-escapes doubled quotes inside a quoted field', () => {
    const result = parseCsv('"Notes"\n"She said ""hi"""\n');
    assert.deepEqual(result, [
        ['Notes'],
        ['She said "hi"'],
    ]);
});

test('parseCsv handles a file with no trailing newline', () => {
    const result = parseCsv('Date,Amount\n2026-01-01,10.00');
    assert.deepEqual(result, [
        ['Date', 'Amount'],
        ['2026-01-01', '10.00'],
    ]);
});

test('parseGenericDate takes the leading date from an ISO date with time and timezone', () => {
    assert.equal(parseGenericDate('2026-11-11 16:42:35 CST'), '2026-11-11');
});

test('parseGenericDate accepts a bare ISO date', () => {
    assert.equal(parseGenericDate('2026-11-11'), '2026-11-11');
});

test('parseGenericDate accepts MM/DD/YYYY', () => {
    assert.equal(parseGenericDate('3/4/2026'), '2026-03-04');
});

test('parseGenericDate throws on an unrecognized format', () => {
    assert.throws(() => parseGenericDate('not a date'));
});

test('parseGenericAmount parses a dollar-prefixed negative amount', () => {
    assert.equal(parseGenericAmount('-$2.10'), -210);
});

test('parseGenericAmount parses a plain positive amount', () => {
    assert.equal(parseGenericAmount('$0.00'), 0);
});

test('parseGenericAmount treats a parenthesized amount as negative', () => {
    assert.equal(parseGenericAmount('(12.34)'), -1234);
});

test('parseGenericAmount strips thousands commas', () => {
    assert.equal(parseGenericAmount('$1,234.56'), 123456);
});

test('parseGenericAmount throws when there are no digits', () => {
    assert.throws(() => parseGenericAmount(''));
});
