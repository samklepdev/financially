import type { Request, Response } from 'express';
import {validateTransaction} from "../helpers/transactionValidation.ts";
import {TransactionService} from "../services/transactions.service.ts";

const transactionService = new TransactionService();

/**
 * Retrieves all transactions from the database, ordered by date and identifier in descending order,
 * and sends them in a JSON response.
 *
 * @param _req - The incoming request object. This parameter is not used.
 * @param res - The response object used to send the transaction data.
 * @return The HTTP response containing the list of transactions.
 */
export function getAllTransactions(_req: Request, res: Response) {
    // Get all transactions from the database
    const transactions = transactionService.getAllTransactions()
    // Return the transactions as a JSON response
    return res.status(200).json({data: transactions});
}

/**
 * Retrieves a transaction by its numeric identifier from the request parameters and sends the result as a JSON response.
 *
 * @param req Express request containing the transaction id route parameter.
 * @param res Express response used to send validation errors, not found errors, or the transaction data.
 * @return The HTTP response containing either an error message or the requested transaction data.
 */
export function getTransactionById(req: Request<{id: string}>, res: Response) {
    // Get the id from the URL and make sure it's a whole number
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'id must be a whole number' });
    }

    // Get a single transaction
    const transaction = transactionService.getTransactionById(id)

    if (!transaction) {
        res.status(400).json({error: 'Transaction not found'})
    }

    res.status(200).json({ data: transaction });
}

/**
 * Creates a new transaction from the request body after validating the submitted data.
 * Responds with a 400 status and validation error when the request body is invalid.
 * Responds with a 201 status and the created transaction when insertion succeeds.
 * Responds with a 400 status when the referenced category or bill does not exist.
 *
 * @param req Express request containing the transaction data in the request body.
 * @param res Express response used to send the creation result or error response.
 * @return The Express response containing the created transaction or an error response.
 */
export function createTransaction(req: Request, res: Response) {
    // Get transaction from the request body & validate it
    const result = validateTransaction(req.body);

    if (!result.ok) {
        return res.status(400).json({error: result.error});
    }

    const t = result.value;

    try {
        const created = transactionService.createTransaction(t)
        // Return the created transaction as a JSON response
        return res.status(201).json({ data: created});
    } catch (err) {
        if (err instanceof Error && err.message.includes('FOREIGN KEY')) {
            return res.status(400).json({ error: 'Category or Bill does not exist' });
        }
        throw err;
    }
}

/**
 * Updates an existing transaction by its request parameter id using the validated request body.
 *
 * @param req Express request containing the transaction id in the route parameters and updated transaction data in the body.
 * @param res Express response used to return the updated transaction or an error response.
 * @return A JSON response with the updated transaction, a validation error, a not found error, a foreign key error, or the thrown error.
 */
export function updateTransaction(req: Request<{id: string}>, res: Response) {
    // Get the Id from the request body
    const id = Number(req.params.id);

    // Validate the Id
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'id must be a whole number'})
    }

    // Validate the body
    const result = validateTransaction(req.body)
    if (!result.ok) {
        return res.status(400).json({ error: result.error})
    }

    const t = result.value;

    try {
        // Update the transaction
        const updated = transactionService.updateTransaction(id, t)

        // Return error if transaction not found
        if (!updated) {
            return res.status(404).json({error: 'Transaction not found'})
        }

        // Return updated transaction
        return res.status(200).json({data: updated})
    } catch (err) {
        if (err instanceof Error && err.message.includes('FOREIGN KEY')) {
            return res.status(400).json({error: 'Category or bill does not exist'})
        }
        return err;
    }
}

/**
 * Deletes a transaction identified by the request route parameter.
 *
 * @param req Express request containing the transaction id in the route parameters.
 * @param res Express response used to return the deletion result.
 * @return A response with status 204 when deleted, 400 when the id is invalid, or 404 when no transaction is found.
 */
export function deleteTransaction(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'Id must be a whole number'})
    }

    const { changes } = transactionService.deleteTransaction(id)

    if (changes === 0) {
        return res.status(404).json({error: 'Transaction not found'})
    }

    return res.status(204).end();
}