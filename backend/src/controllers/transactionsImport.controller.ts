import type {Request, Response} from 'express';
import {parseCashAppStatementPdf} from '../services/cashAppStatementParser.ts';
import {validateTransaction} from '../helpers/transactionValidation.ts';
import {TransactionService} from '../services/transactions.service.ts';
import type {NewTransaction} from '../types/transaction.ts';

const transactionService = new TransactionService();

/**
 * Parses an uploaded PDF statement into candidate transactions, each flagged
 * with whether a similar transaction already exists. Writes nothing to the DB.
 */
export async function previewImport(req: Request, res: Response) {
    const file = req.file;

    if (!file) {
        return res.status(400).json({error: 'No file uploaded'});
    }

    if (file.mimetype !== 'application/pdf') {
        return res.status(400).json({error: 'File must be a PDF'});
    }

    let transactions: NewTransaction[];
    try {
        transactions = await parseCashAppStatementPdf(file.buffer);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not parse this PDF';
        return res.status(400).json({error: message});
    }

    const withDuplicateFlags = transactions.map((t) => ({
        ...t,
        isDuplicate: transactionService.existsSimilar(t.date, t.description, t.amount_cents),
    }));

    return res.status(200).json({data: {transactions: withDuplicateFlags}});
}

/**
 * Validates and inserts a confirmed batch of transactions, all-or-nothing.
 */
export function confirmImport(req: Request, res: Response) {
    const body = req.body?.transactions;

    if (!Array.isArray(body)) {
        return res.status(400).json({error: 'transactions must be an array'});
    }

    const validated: NewTransaction[] = [];
    for (const item of body) {
        const result = validateTransaction(item);
        if (!result.ok) {
            return res.status(400).json({error: result.error});
        }
        validated.push(result.value as NewTransaction);
    }

    const created = transactionService.createMany(validated);
    return res.status(201).json({data: {created: created.length}});
}
