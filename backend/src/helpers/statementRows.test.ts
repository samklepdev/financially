import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
    groupIntoRows,
    findHeaderRowIndex,
    columnBoundsFromRow,
    bucketRow,
    isNoiseRow,
    isContinuationRow,
    mergeContinuations,
    type TextItem,
    type BucketedRow,
} from './statementRows.ts';

const HEADER: TextItem[] = [
    {text: 'Date', x: 56, y: 100},
    {text: 'Description', x: 98, y: 100},
    {text: 'Details', x: 300, y: 100},
    {text: 'Fee', x: 458, y: 100},
    {text: 'Amount', x: 512, y: 100},
];

test('groupIntoRows clusters items by close y and sorts rows top to bottom', () => {
    const items: TextItem[] = [
        {text: 'B', x: 0, y: 140},
        {text: 'A', x: 0, y: 100},
        {text: 'A2', x: 10, y: 101},
    ];
    const rows = groupIntoRows(items);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].map((i) => i.text), ['A', 'A2']);
    assert.deepEqual(rows[1].map((i) => i.text), ['B']);
});

test('findHeaderRowIndex finds the row containing all five header labels', () => {
    const rows = [[{text: 'Transactions', x: 56, y: 60}], HEADER, [{text: 'Sep 5', x: 56, y: 140}]];
    assert.equal(findHeaderRowIndex(rows), 1);
});

test('findHeaderRowIndex returns -1 when no header row is present', () => {
    assert.equal(findHeaderRowIndex([[{text: 'nope', x: 0, y: 0}]]), -1);
});

test('columnBoundsFromRow reads each label\'s x position', () => {
    const bounds = columnBoundsFromRow(HEADER);
    assert.deepEqual(bounds, {date: 56, description: 98, details: 300, fee: 458, amount: 512});
});

test('bucketRow assigns items using midpoint boundaries, not raw header x', () => {
    // Real Cash App data: Fee/Amount values are right-aligned and sit to the
    // LEFT of their own header label's x position, so a naive "x >= header x"
    // rule would misbucket them. Midpoints between adjacent headers fix this.
    const bounds = columnBoundsFromRow(HEADER);
    const row: TextItem[] = [
        {text: 'Sep 5', x: 56, y: 140},
        {text: 'Walmart Houston TX', x: 98, y: 140},
        {text: 'Paper money deposit', x: 300, y: 140},
        {text: '$1.00', x: 450, y: 140}, // left of the Fee header's own x (458)
        {text: '+ $100.00', x: 503, y: 140}, // left of the Amount header's own x (512)
    ];
    const bucketed = bucketRow(row, bounds);
    assert.deepEqual(bucketed, {
        date: 'Sep 5',
        description: 'Walmart Houston TX',
        details: 'Paper money deposit',
        fee: '$1.00',
        amount: '+ $100.00',
    });
});

test('isNoiseRow is true only when date, description, and details are all empty', () => {
    const noise: BucketedRow = {date: '', description: '', details: '', fee: '', amount: '2 / 15'};
    const real: BucketedRow = {date: '', description: 'x8703', details: '', fee: '', amount: ''};
    assert.equal(isNoiseRow(noise), true);
    assert.equal(isNoiseRow(real), false);
});

test('isContinuationRow is true when date, fee, and amount are all empty', () => {
    const continuation: BucketedRow = {date: '', description: 'x8703', details: '', fee: '', amount: ''};
    const normal: BucketedRow = {date: 'Sep 5', description: 'A', details: 'B', fee: '$0.00', amount: '$1.00'};
    assert.equal(isContinuationRow(continuation), true);
    assert.equal(isContinuationRow(normal), false);
});

test('mergeContinuations appends a continuation row\'s text onto the previous row', () => {
    const rows: BucketedRow[] = [
        {date: 'Sep 7', description: 'From Stride Bank, National Association', details: 'Standard transfer', fee: '$0.00', amount: '+ $57.00'},
        {date: '', description: 'x8703', details: '', fee: '', amount: ''},
    ];
    const merged = mergeContinuations(rows);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].description, 'From Stride Bank, National Association x8703');
});

test('mergeContinuations drops a leading continuation-shaped row with nothing before it', () => {
    const rows: BucketedRow[] = [{date: '', description: 'stray', details: '', fee: '', amount: ''}];
    assert.deepEqual(mergeContinuations(rows), [{date: '', description: 'stray', details: '', fee: '', amount: ''}]);
});
