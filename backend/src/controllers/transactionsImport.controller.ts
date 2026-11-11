import type {Request, Response} from 'express';
import {parseCashAppStatementPdf} from '../services/cashAppStatementParser.ts';
import {validateTransaction} from '../helpers/transactionValidation.ts';
import {TransactionService} from '../services/transactions.service.ts';
import {CategoryRuleService} from '../services/categoryRules.service.ts';
import {suggestCategories} from '../services/ollamaCategorySuggester.service.ts';
import type {NewTransaction} from '../types/transaction.ts';

const transactionService = new TransactionService();
const categoryRuleService = new CategoryRuleService();

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

    const withRuleSuggestions = transactions.map((t) => ({
        ...t,
        category_id: transactionService.findRecentCategoryForDescription(t.description)
            ?? categoryRuleService.findCategoryForDescription(t.description),
        isDuplicate: transactionService.existsSimilar(t.date, t.description, t.amount_cents),
    }));

    const unmatchedDescriptions = withRuleSuggestions
        .filter((t) => t.category_id === null)
        .map((t) => t.description);
    const aiSuggestions = await suggestCategories(unmatchedDescriptions);

    const withSuggestions = withRuleSuggestions.map((t) => {
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

    return res.status(200).json({data: {transactions: withSuggestions}});
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
