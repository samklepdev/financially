import {useState} from "react";
import type {Bill, UpcomingBill} from "../types/bill.ts";
import type {Category} from "../types/category.ts";

type Props = {
    bill: Bill;
    categories: Category[];
    upcoming?: UpcomingBill;
    onUpdate: (bill: Bill, patch: Partial<Bill>) => Promise<void>;
    onDelete: (id: number) => void;
};

function BillRow({bill, categories, upcoming, onUpdate, onDelete}: Props) {
    const [draftName, setDraftName] = useState(bill.name);
    const [draftAmount, setDraftAmount] = useState((bill.amount_cents / 100).toFixed(2));
    const [draftDueDay, setDraftDueDay] = useState(String(bill.due_day));
    const [draftPattern, setDraftPattern] = useState(bill.match_pattern);
    const [showDeferInput, setShowDeferInput] = useState(false);
    const [deferDraft, setDeferDraft] = useState('');

    // Each commit sends a full snapshot of the row's current (validated) draft
    // values, not just the single field that triggered the blur. Rows are edited
    // one field at a time but a PATCH for field A can still be in flight when the
    // user blurs field B; building each request purely from the single changed
    // field would let an in-flight request for A overwrite B (or vice versa) if
    // responses resolve out of order. Sending the whole row every time means any
    // order of resolution converges on the same final state.

    function safeAmountCents(): number {
        const value = Number(draftAmount);
        return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : bill.amount_cents;
    }

    function safeDueDay(): number {
        const value = Number(draftDueDay);
        return Number.isInteger(value) && value >= 1 && value <= 31 ? value : bill.due_day;
    }

    function commitName() {
        if (draftName === bill.name) {
            return;
        }
        onUpdate(bill, {
            name: draftName,
            amount_cents: safeAmountCents(),
            due_day: safeDueDay(),
            match_pattern: draftPattern,
        });
    }

    function commitAmount() {
        const value = Number(draftAmount);
        if (!Number.isFinite(value) || value <= 0) {
            setDraftAmount((bill.amount_cents / 100).toFixed(2));
            return;
        }

        const amount_cents = Math.round(value * 100);
        setDraftAmount((amount_cents / 100).toFixed(2));
        if (amount_cents === bill.amount_cents) {
            return;
        }
        onUpdate(bill, {
            name: draftName,
            amount_cents,
            due_day: safeDueDay(),
            match_pattern: draftPattern,
        });
    }

    function commitDueDay() {
        const value = Number(draftDueDay);
        if (!Number.isInteger(value) || value < 1 || value > 31) {
            setDraftDueDay(String(bill.due_day));
            return;
        }

        setDraftDueDay(String(value));
        if (value === bill.due_day) {
            return;
        }
        onUpdate(bill, {
            name: draftName,
            amount_cents: safeAmountCents(),
            due_day: value,
            match_pattern: draftPattern,
        });
    }

    function commitPattern() {
        if (draftPattern === bill.match_pattern) {
            return;
        }
        onUpdate(bill, {
            name: draftName,
            amount_cents: safeAmountCents(),
            due_day: safeDueDay(),
            match_pattern: draftPattern,
        });
    }

    function commitCategory(categoryId: number | null) {
        onUpdate(bill, {
            name: draftName,
            amount_cents: safeAmountCents(),
            due_day: safeDueDay(),
            match_pattern: draftPattern,
            category_id: categoryId,
        });
    }

    function togglePaid() {
        if (!upcoming) {
            return;
        }
        onUpdate(bill, {
            name: draftName,
            amount_cents: safeAmountCents(),
            due_day: safeDueDay(),
            match_pattern: draftPattern,
            marked_paid_for: upcoming.markedPaid ? null : upcoming.dueDate,
        });
    }

    function confirmDefer() {
        if (deferDraft === '') {
            return;
        }
        onUpdate(bill, {
            name: draftName,
            amount_cents: safeAmountCents(),
            due_day: safeDueDay(),
            match_pattern: draftPattern,
            deferred_until: deferDraft,
        });
        setShowDeferInput(false);
        setDeferDraft('');
    }

    function clearDefer() {
        onUpdate(bill, {
            name: draftName,
            amount_cents: safeAmountCents(),
            due_day: safeDueDay(),
            match_pattern: draftPattern,
            deferred_until: null,
        });
    }

    return (
        <article className="ledger-row bill-row">
            <label className="bill-field bill-field--grow">
                <span className="bill-field__label">Name</span>
                <input
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={commitName}
                />
            </label>
            <label className="bill-field">
                <span className="bill-field__label">Amount</span>
                <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="bill-amount-input"
                    value={draftAmount}
                    onChange={(e) => setDraftAmount(e.target.value)}
                    onBlur={commitAmount}
                />
            </label>
            <label className="bill-field">
                <span className="bill-field__label">Due day</span>
                <input
                    type="number"
                    min="1"
                    max="31"
                    className="bill-due-day-input"
                    value={draftDueDay}
                    onChange={(e) => setDraftDueDay(e.target.value)}
                    onBlur={commitDueDay}
                />
            </label>
            <label className="bill-field bill-field--grow">
                <span className="bill-field__label">Match pattern</span>
                <input
                    type="text"
                    value={draftPattern}
                    onChange={(e) => setDraftPattern(e.target.value)}
                    onBlur={commitPattern}
                />
            </label>
            <label className="bill-field">
                <span className="bill-field__label">Category</span>
                <select
                    className="ledger-category-select"
                    value={bill.category_id ?? ''}
                    onChange={(e) => commitCategory(e.target.value === '' ? null : Number(e.target.value))}
                >
                    <option value="">Uncategorized</option>
                    {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
            </label>
            {upcoming && (
                upcoming.status === 'paid' && !upcoming.markedPaid ? (
                    <span className="bill-paid bill-paid--auto">Paid</span>
                ) : (
                    <span className="bill-paid">
                        <span className={`bill-paid__label ${upcoming.markedPaid ? 'bill-paid__label--marked' : ''}`}>
                            {upcoming.markedPaid ? 'Marked paid' : upcoming.status === 'overdue' ? 'Overdue' : 'Due soon'}
                        </span>
                        <button type="button" onClick={togglePaid}>
                            {upcoming.markedPaid ? 'Mark unpaid' : 'Mark paid'}
                        </button>
                    </span>
                )
            )}
            {bill.deferred_until === null ? (
                showDeferInput ? (
                    <span className="bill-defer">
                        <input
                            type="date"
                            className="bill-defer-input"
                            value={deferDraft}
                            onChange={(e) => setDeferDraft(e.target.value)}
                        />
                        <button type="button" onClick={confirmDefer}>Confirm</button>
                        <button type="button" onClick={() => {setShowDeferInput(false); setDeferDraft('');}}>Cancel</button>
                    </span>
                ) : (
                    <button type="button" onClick={() => setShowDeferInput(true)}>Defer</button>
                )
            ) : (
                <span className="bill-defer">
                    <span className="bill-defer__label">Deferred to {bill.deferred_until}</span>
                    <button type="button" onClick={clearDefer}>Clear</button>
                </span>
            )}
            <button type="button" onClick={() => onDelete(bill.id)}>Delete</button>
        </article>
    );
}

export default BillRow
