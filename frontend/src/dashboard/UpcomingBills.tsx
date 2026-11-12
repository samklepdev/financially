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

    const unpaid = (upcoming ?? []).filter((u) => u.status !== 'paid');

    return (
        <article className="chart-card upcoming-bills-card" aria-label="Upcoming bills">
            <h3 className="chart-card__title">Upcoming Bills</h3>
            {error && <p className="ledger-status error">{error}</p>}
            {!error && upcoming !== undefined && unpaid.length === 0 && (
                <p className="upcoming-bills-empty">Nothing due soon.</p>
            )}
            {!error && unpaid.map((u) => (
                <div
                    key={u.bill.id}
                    className={`upcoming-bill-row ${u.status === 'overdue' ? 'upcoming-bill-row--overdue' : ''}`}
                >
                    <span className="upcoming-bill-name">{u.bill.name}</span>
                    <span className="upcoming-bill-amount">{formatMoney(u.bill.amount_cents)}</span>
                    <span className="upcoming-bill-due">{dueDateLabel(u, today)}</span>
                </div>
            ))}
        </article>
    );
}

export default UpcomingBills;
