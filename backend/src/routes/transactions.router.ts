import express from "express";
import {createTransaction, getAllTransactions} from "../controllers/transactions.controller.ts";

export const transactionsRouter = express.Router()

transactionsRouter.get('/', getAllTransactions);
transactionsRouter.post('/', createTransaction);
