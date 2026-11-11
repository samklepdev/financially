import express from "express";
import multer from "multer";
import {
    createTransaction, deleteTransaction,
    getAllTransactions,
    getTransactionById,
    suggestCategoryForDescription,
    updateTransaction
} from "../controllers/transactions.controller.ts";
import {previewImport, previewCsvImport, confirmImport} from "../controllers/transactionsImport.controller.ts";

const upload = multer({storage: multer.memoryStorage(), limits: {fileSize: 10 * 1024 * 1024}});

export const transactionsRouter = express.Router()

transactionsRouter.get('/', getAllTransactions);
transactionsRouter.post('/', createTransaction);
transactionsRouter.post('/suggest-category', suggestCategoryForDescription);
transactionsRouter.post('/import/preview', upload.single('file'), previewImport);
transactionsRouter.post('/import/csv/preview', upload.single('file'), previewCsvImport);
transactionsRouter.post('/import', confirmImport);
transactionsRouter.get('/:id', getTransactionById);
transactionsRouter.put('/:id', updateTransaction);
transactionsRouter.delete('/:id', deleteTransaction);
