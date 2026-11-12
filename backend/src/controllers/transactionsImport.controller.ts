import type {Request, Response} from 'express';
import {parseCashAppStatementPdf} from '../services/cashAppStatementParser.ts';
import {parseCsv} from '../helpers/csvParsing.ts';
import {mapCsvToTransactions} from '../services/csvImportMapper.service.ts';
import {validateTransaction} from '../helpers/transactionValidation.ts';
import {TransactionService} from '../services/transactions.service.ts';
import {CategoryRuleService} from '../services/categoryRules.service.ts';
import {suggestCategories} from '../services/ollamaCategorySuggester.service.ts';
import {resolveNewCategories} from '../services/importCategoryResolver.service.ts';
import type {ImportConfirmItem} from '../services/importCategoryResolver.service.ts';
import type {ImportCandidate, NewTransaction} from '../types/transaction.ts';
import {BillService} from '../services/bill.service.ts';

const transactionService = new TransactionService();
const categoryRuleService = new CategoryRuleService();
const billService = new BillService();

/**
 * Enriches parsed transactions with a suggested category (exact-history
 * match, then keyword rule, then a local-Ollama fallback for anything still
 * unmatched) and an `isDuplicate` flag, regardless of which parser produced
 * them. Shared by both the PDF and CSV preview endpoints.
 */
async function buildImportCandidates(transactions: NewTransaction[]): Promise<ImportCandidate[]> {
    const withRuleSuggestions = transactions.map((t) => ({
        ...t,
        category_id: transactionService.findRecentCategoryForDescription(t.description)
            ?? categoryRuleService.findCategoryForDescription(t.description),
        bill_id: billService.findBillForDescription(t.description),
        isDuplicate: transactionService.existsSimilar(t.date, t.description, t.amount_cents),
    }));

    const unmatchedDescriptions = withRuleSuggestions
        .filter((t) => t.category_id === null)
        .map((t) => t.description);
    const aiSuggestions = await suggestCategories(unmatchedDescriptions);

    return withRuleSuggestions.map((t) => {
        if (t.category_id !== null) {
            return {...t, aiSuggested: false, proposedCategoryName: null};
        }
        const suggestion = aiSuggestions[t.description];
        if (!suggestion || suggestion.kind === 'none') {
            return {...t, aiSuggested: false, proposedCategoryName: null};
        }
        if (suggestion.kind === 'existing') {
            return {...t, category_id: suggestion.categoryId, aiSuggested: true, proposedCategoryName: null};
        }
        return {...t, category_id: null, aiSuggested: true, proposedCategoryName: suggestion.name};
    });
}

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

    const candidates = await buildImportCandidates(transactions);
    return res.status(200).json({data: {transactions: candidates}});
}

/**
 * Parses an uploaded CSV file into candidate transactions using a
 * user-chosen column mapping (date/description/amount column names). Rows
 * that fail to parse are reported in `errors` and skipped rather than
 * failing the whole upload. Writes nothing to the DB.
 */
export async function previewCsvImport(req: Request, res: Response) {
    const file = req.file;
    if (!file) {
        return res.status(400).json({error: 'No file uploaded'});
    }

    const dateColumn = req.body?.dateColumn;
    const descriptionColumn = req.body?.descriptionColumn;
    const amountColumn = req.body?.amountColumn;
    if (
        typeof dateColumn !== 'string' || typeof descriptionColumn !== 'string'
        || typeof amountColumn !== 'string'
    ) {
        return res.status(400).json({error: 'dateColumn, descriptionColumn, and amountColumn are required'});
    }

    const rows = parseCsv(file.buffer.toString('utf-8'));
    if (rows.length === 0) {
        return res.status(400).json({error: 'CSV file is empty'});
    }
    const [headers, ...dataRows] = rows;

    const requestedColumns: [string, string][] = [
        ['dateColumn', dateColumn], ['descriptionColumn', descriptionColumn], ['amountColumn', amountColumn],
    ];
    for (const [label, column] of requestedColumns) {
        if (!headers.includes(column)) {
            return res.status(400).json({error: `${label} "${column}" is not a column in this CSV`});
        }
    }

    const {transactions, errors} = mapCsvToTransactions(headers, dataRows, {
        date: dateColumn, description: descriptionColumn, amount: amountColumn,
    });

    const candidates = await buildImportCandidates(transactions);
    return res.status(200).json({data: {transactions: candidates, errors}});
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

    const withNewCategoryNames: ImportConfirmItem[] = validated.map((t, i) => ({
        ...t,
        newCategoryName: body[i]?.newCategoryName,
    }));
    const resolved = resolveNewCategories(withNewCategoryNames);

    const created = transactionService.createMany(resolved);
    return res.status(201).json({data: {created: created.length}});
}
