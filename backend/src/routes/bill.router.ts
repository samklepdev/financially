import express from "express";
import {
    createBill, deleteBill, getAllBills, getBillById, getSuggestedBills, getUpcomingBills, updateBill
} from "../controllers/bill.controller.ts";

export const billsRouter = express.Router()

billsRouter.get('/', getAllBills);
billsRouter.post('/', createBill);
billsRouter.get('/upcoming', getUpcomingBills);
billsRouter.get('/suggestions', getSuggestedBills);
billsRouter.get('/:id', getBillById);
billsRouter.put('/:id', updateBill);
billsRouter.delete('/:id', deleteBill);
