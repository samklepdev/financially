import express from "express";
import {
    createTransaction, deleteTransaction,
    getAllTransactions,
    getTransactionById,
    updateTransaction
} from "../controllers/transactions.controller.ts";

export const transactionsRouter = express.Router()

transactionsRouter.get('/', getAllTransactions);
transactionsRouter.post('/', createTransaction);
transactionsRouter.get('/:id', getTransactionById);
transactionsRouter.put('/:id', updateTransaction);
transactionsRouter.delete('/:id', deleteTransaction);