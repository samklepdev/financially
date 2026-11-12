import {useState} from "react";
import type {Bill} from "../types/bill.ts";

type Props = {
    bill: Bill;
    onUpdate: (bill: Bill, patch: Partial<Bill>) => Promise<void>;
    onDelete: (id: number) => void;
};

function BillRow({bill, onUpdate, onDelete}: Props) {
    const [draftName, setDraftName] = useState(bill.name);
    const [draftAmount, setDraftAmount] = useState((bill.amount_cents / 100).toFixed(2));
    const [draftDueDay, setDraftDueDay] = useState(String(bill.due_day));
    const [draftPattern, setDraftPattern] = useState(bill.match_pattern);

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

    return (
        <article className="ledger-row bill-row">
            <input
                type="text"
                className="bill-name-input"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitName}
            />
            <input
                type="number"
                step="0.01"
                min="0.01"
                className="bill-amount-input"
                value={draftAmount}
                onChange={(e) => setDraftAmount(e.target.value)}
                onBlur={commitAmount}
            />
            <input
                type="number"
                min="1"
                max="31"
                className="bill-due-day-input"
                value={draftDueDay}
                onChange={(e) => setDraftDueDay(e.target.value)}
                onBlur={commitDueDay}
            />
            <input
                type="text"
                className="bill-pattern-input"
                value={draftPattern}
                onChange={(e) => setDraftPattern(e.target.value)}
                onBlur={commitPattern}
            />
            <button type="button" onClick={() => onDelete(bill.id)}>Delete</button>
        </article>
    );
}

export default BillRow
