import {db} from "../config/db.ts";
import type {Bill, NewBill} from "../types/bill.ts";

export class BillService {
    /**
     * Retrieves all bills from the database, ordered alphabetically by name.
     *
     * @return {Bill[]} An array of bills sorted A-Z by name.
     */
    getAllBills() {
        return db.prepare('SELECT * FROM bills ORDER BY name').all() as Bill[];
    }

    /**
     * Retrieves a bill by its unique identifier.
     *
     * @param id The unique identifier of the bill to retrieve.
     * @return The matching bill, or undefined if no bill is found.
     */
    getBillById(id: number) {
        return db.prepare('SELECT * FROM bills WHERE id = ?').get(id) as Bill | undefined;
    }

    /**
     * Creates a new bill record in the database and returns the inserted bill.
     *
     * @param bill The bill data to insert, including name, amount_cents, due_day, and match_pattern.
     * @return The newly created bill record.
     */
    createBill(bill: NewBill) {
        return db.prepare(
            'INSERT INTO bills (name, amount_cents, due_day, match_pattern) VALUES (?, ?, ?, ?) RETURNING *'
        ).get(bill.name, bill.amount_cents, bill.due_day, bill.match_pattern) as Bill;
    }

    /**
     * Updates an existing bill record with the provided bill data.
     *
     * @param id The unique identifier of the bill to update.
     * @param bill The new bill data to apply.
     * @return The updated bill record, or undefined if no bill was updated.
     */
    updateBill(id: number, bill: NewBill) {
        return db.prepare(
            'UPDATE bills SET name = ?, amount_cents = ?, due_day = ?, match_pattern = ? WHERE id = ? RETURNING *'
        ).get(bill.name, bill.amount_cents, bill.due_day, bill.match_pattern, id) as Bill | undefined;
    }

    /**
     * Deletes a bill with the specified identifier from the database.
     *
     * @param id The unique identifier of the bill to delete.
     * @return The result of the delete operation, including the number of affected rows.
     */
    deleteBill(id: number) {
        return db.prepare('DELETE FROM bills WHERE id = ?').run(id);
    }

    /**
     * Finds the bill whose match_pattern is the longest case-insensitive
     * substring match of the given description. Bills with an empty
     * match_pattern never match. Used to auto-link a newly imported or
     * manually added transaction to a bill.
     *
     * @return The matching bill's id, or null if no bill's pattern matches.
     */
    findBillForDescription(description: string): number | null {
        const row = db.prepare(
            `SELECT id FROM bills
             WHERE match_pattern != '' AND instr(lower(?), lower(match_pattern)) > 0
             ORDER BY length(match_pattern) DESC LIMIT 1`
        ).get(description) as {id: number} | undefined;
        return row?.id ?? null;
    }
}
