import {db} from "../config/db.ts";
import type {Bill, NewBill} from "../types/bill.ts";

function lastDayOfMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function dueDateForMonth(year: number, month: number, dueDay: number): Date {
    const day = Math.min(dueDay, lastDayOfMonth(year, month));
    return new Date(Date.UTC(year, month, day));
}

function toISODate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

export type UpcomingBill = {
    bill: Bill;
    dueDate: string;
    status: 'paid' | 'overdue' | 'upcoming';
};

export type SuggestedBill = {
    description: string;
    amount_cents: number;
    suggested_due_day: number;
    occurrences: number;
};

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

    /**
     * Computes each bill's current-cycle due date and payment status.
     * A bill is only included when its due date is overdue (in the past
     * this cycle) or within the next 14 days — bills due further out are
     * omitted entirely. "Paid" means a transaction with this bill's id
     * falls within the window from the previous cycle's due date
     * (inclusive) up to the next cycle's due date (exclusive).
     *
     * @param today Reference date for "now" (defaults to the current time); only its UTC calendar date is used.
     * @return Upcoming/overdue/paid bills, sorted by due date ascending.
     */
    getUpcomingBills(today: Date = new Date()): UpcomingBill[] {
        const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
        const bills = this.getAllBills();
        const result: UpcomingBill[] = [];

        for (const bill of bills) {
            const dueDate = dueDateForMonth(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), bill.due_day);
            const prevDueDate = dueDateForMonth(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth() - 1, bill.due_day);
            const nextDueDate = dueDateForMonth(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth() + 1, bill.due_day);

            const daysUntilDue = Math.round((dueDate.getTime() - todayUTC.getTime()) / (24 * 60 * 60 * 1000));
            if (daysUntilDue > 14) {
                continue;
            }

            const paid = db.prepare(
                'SELECT 1 FROM transactions WHERE bill_id = ? AND date >= ? AND date < ? LIMIT 1'
            ).get(bill.id, toISODate(prevDueDate), toISODate(nextDueDate)) !== undefined;

            result.push({
                bill,
                dueDate: toISODate(dueDate),
                status: paid ? 'paid' : (daysUntilDue < 0 ? 'overdue' : 'upcoming'),
            });
        }

        return result.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    }

    /**
     * Groups transactions with no linked bill by exact (description,
     * amount_cents), and suggests any group with 3 or more occurrences
     * whose consecutive dates are each 28-33 days apart (tolerates
     * weekend/month-length drift without catching unrelated repeat
     * purchases). Excludes any description already matched by an existing
     * bill's match_pattern.
     *
     * @return Candidate recurring bills, in no particular order.
     */
    getSuggestedBills(): SuggestedBill[] {
        const rows = db.prepare(
            `SELECT description, amount_cents, date FROM transactions
             WHERE bill_id IS NULL ORDER BY description, amount_cents, date`
        ).all() as {description: string, amount_cents: number, date: string}[];

        const groups = new Map<string, {description: string, amount_cents: number, dates: string[]}>();
        for (const row of rows) {
            const key = `${row.description}|${row.amount_cents}`;
            const group = groups.get(key);
            if (group) {
                group.dates.push(row.date);
            } else {
                groups.set(key, {description: row.description, amount_cents: row.amount_cents, dates: [row.date]});
            }
        }

        const suggestions: SuggestedBill[] = [];
        for (const group of groups.values()) {
            if (group.dates.length < 3) {
                continue;
            }
            if (this.findBillForDescription(group.description) !== null) {
                continue;
            }

            const sortedDates = [...group.dates].sort();
            const isMonthly = sortedDates.slice(1).every((date, i) => {
                const prev = new Date(`${sortedDates[i]}T00:00:00Z`).getTime();
                const curr = new Date(`${date}T00:00:00Z`).getTime();
                const gapDays = Math.round((curr - prev) / (24 * 60 * 60 * 1000));
                return gapDays >= 28 && gapDays <= 33;
            });
            if (!isMonthly) {
                continue;
            }

            const mostRecentDate = sortedDates[sortedDates.length - 1];
            suggestions.push({
                description: group.description,
                amount_cents: group.amount_cents,
                suggested_due_day: Number(mostRecentDate.slice(8, 10)),
                occurrences: sortedDates.length,
            });
        }

        return suggestions;
    }
}
