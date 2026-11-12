import {useEffect, useState} from "react";
import {billApiService} from "../services/BillApiService.ts";
import type {UpcomingBill} from "../types/bill.ts";
import {formatMoney} from "../helpers/money.ts";
import './UpcomingBills.css'

function dueDateLabel(upcoming: UpcomingBill, today: Date): string {
    const due = new Date(`${upcoming.dueDate}T00:00:00Z`);
    const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const daysUntilDue = Math.round((due.getTime() - todayUTC.getTime()) / (24 * 60 * 60 * 1000));

    if (upcoming.status === 'overdue') {
        return `Overdue (was due ${upcoming.dueDate})`;
    }
    if (daysUntilDue === 0) {
        return 'Due today';
    }
    return `Due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`;
}

function UpcomingBills() {
    const [upcoming, setUpcoming] = useState<UpcomingBill[]>();
    const [error, setError] = useState<string | null>(null);
    const today = new Date();

    useEffect(() => {
        billApiService.getUpcomingBills().then(setUpcoming).catch((err) => {
            setError(err instanceof Error ? err.message : 'Could not load upcoming bills');
        });
    }, []);

    async function togglePaid(u: UpcomingBill) {
        setError(null);
        const marked_paid_for = u.markedPaid ? null : u.dueDate;
        try {
            await billApiService.updateBill(u.bill.id, {
                name: u.bill.name,
                amount_cents: u.bill.amount_cents,
                due_day: u.bill.due_day,
                match_pattern: u.bill.match_pattern,
                deferred_until: u.bill.deferred_until,
                category_id: u.bill.category_id,
                marked_paid_for,
            });
            // Re-fetch rather than patching status/markedPaid locally: un-marking
            // doesn't tell us what the real status reverts to (overdue vs
            // upcoming, or paid-via-transaction) without redoing the same
            // cycle/transaction-window math the backend already owns.
            setUpcoming(await billApiService.getUpcomingBills());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not update this bill');
        }
    }

    // Auto-detected paid bills (a linked transaction already accounts for
    // them) stay hidden, same as before. A manually marked-paid bill stays
    // visible — dimmed, with an undo — since there's no transaction backing
    // it up; hiding it would leave no way to notice and correct a mistake.
    const visible = (upcoming ?? []).filter((u) => u.status !== 'paid' || u.markedPaid);

    return (
        <article className="chart-card upcoming-bills-card" aria-label="Upcoming bills">
            <h3 className="chart-card__title">Upcoming Bills</h3>
            {error && <p className="ledger-status error">{error}</p>}
            {!error && upcoming !== undefined && visible.length === 0 && (
                <p className="upcoming-bills-empty">Nothing due soon.</p>
            )}
            {!error && visible.map((u) => (
                <div
                    key={u.bill.id}
                    className={[
                        'upcoming-bill-row',
                        u.status === 'overdue' ? 'upcoming-bill-row--overdue' : '',
                        u.markedPaid ? 'upcoming-bill-row--paid' : '',
                    ].filter(Boolean).join(' ')}
                >
                    <span className="upcoming-bill-name">{u.bill.name}</span>
                    <span className="upcoming-bill-amount">{formatMoney(u.bill.amount_cents)}</span>
                    <span className="upcoming-bill-due">
                        {u.markedPaid ? 'Marked paid' : dueDateLabel(u, today)}
                    </span>
                    <button type="button" className="upcoming-bill-toggle" onClick={() => togglePaid(u)}>
                        {u.markedPaid ? 'Mark unpaid' : 'Mark paid'}
                    </button>
                </div>
            ))}
        </article>
    );
}

export default UpcomingBills;
