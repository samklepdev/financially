import type { Request, Response } from 'express';
import type {NewTransaction, Transaction} from "../types/transaction.ts";
import {validateTransaction} from "../helpers/transactionValidation.ts";
import {db} from "../config/db.ts";

/**
 * @desc Get all transactions
 * @desc GET /api/v1/transactions
 * @param _req
 * @param res
 */
export function getAllTransactions(_req: Request, res: Response) {
    // Get all transactions from the database
    const transactions = db.prepare('SELECT * FROM transactions ORDER BY date DESC, id DESC').all() as Transaction[];
    // Return the transactions as a JSON response
    return res.status(200).json({data: transactions});
}

/**
 * @desc Create a new transaction
 * @desc POST /api/v1/transactions
 * @param req
 * @param res
 */
export function createTransaction(req: Request, res: Response) {
    // Get transaction from the request body & validate it
    const result = validateTransaction(req.body);

    if (!result.ok) {
        return res.status(400).json({error: result.error});
    }

    const t = result.value;

    try {
        const created = db
            .prepare(`INSERT INTO transactions (date, description, amount_cents, category_id, bill_id)
                VALUES (?, ?, ?, ?, ?) RETURNING *`)
            .get(t.date, t.description, t.amount_cents, t.category_id, t.bill_id) as Transaction;
        // Return the created transaction as a JSON response
        return res.status(201).json({ data: created});
    } catch (err) {
        if (err instanceof Error && err.message.includes('FOREIGN KEY')) {
            return res.status(400).json({ error: 'Category or Bill does not exist' });
        }
        throw err;
    }
}