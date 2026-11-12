import {BaseApiService} from "./BaseApiService.ts";
import type {Bill, NewBill, SuggestedBill, UpcomingBill} from "../types/bill.ts";

export class BillApiService extends BaseApiService {

    constructor() {
        super('/bills');
    }

    getAllBills(): Promise<Bill[]> {
        return this.getAll<Bill[]>();
    }

    createBill(body: NewBill): Promise<Bill> {
        return this.create<Bill>(body);
    }

    updateBill(id: number, body: NewBill): Promise<Bill> {
        return this.update<Bill>(id, body);
    }

    deleteBill(id: number): Promise<void> {
        return this.delete(id);
    }

    getUpcomingBills(): Promise<UpcomingBill[]> {
        return this.getById<UpcomingBill[]>('upcoming');
    }

    getSuggestedBills(): Promise<SuggestedBill[]> {
        return this.getById<SuggestedBill[]>('suggestions');
    }
}

export const billApiService = new BillApiService();
