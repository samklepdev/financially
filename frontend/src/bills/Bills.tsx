import {useEffect, useState} from "react";
import {billApiService} from "../services/BillApiService.ts";
import type {Bill, SuggestedBill} from "../types/bill.ts";
import {formatMoney} from "../helpers/money.ts";
import BillRow from "./BillRow.tsx";
import "../styles/ledger.css"
import './Bills.css'

function Bills() {
    const [bills, setBills] = useState<Bill[]>();
    const [suggestions, setSuggestions] = useState<SuggestedBill[]>([]);
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const [newName, setNewName] = useState('');
    const [newAmount, setNewAmount] = useState('');
    const [newDueDay, setNewDueDay] = useState('1');
    const [newPattern, setNewPattern] = useState('');

    useEffect(() => {
        Promise.all([
            billApiService.getAllBills(),
            billApiService.getSuggestedBills(),
        ]).then(([b, s]) => {
            setBills(b);
            setSuggestions(s);
        }).catch((err) => {
            setError(err.message);
        }).finally(() => {
            setLoading(false);
        });
    }, []);

    function prefillFromSuggestion(suggestion: SuggestedBill) {
        setNewName(suggestion.description);
        setNewAmount((Math.abs(suggestion.amount_cents) / 100).toFixed(2));
        setNewDueDay(String(suggestion.suggested_due_day));
        setNewPattern(suggestion.description);
    }

    function dismissSuggestion(suggestion: SuggestedBill) {
        setDismissed((prev) => new Set(prev).add(`${suggestion.description} ${suggestion.amount_cents}`));
    }

    async function handleAdd() {
        const amountValue = Number(newAmount);
        const dueDayValue = Number(newDueDay);
        if (newName.trim() === '' || !Number.isFinite(amountValue) || amountValue <= 0) {
            return;
        }

        setError(null);
        try {
            const created = await billApiService.createBill({
                name: newName.trim(),
                amount_cents: Math.round(amountValue * 100),
                due_day: dueDayValue,
                match_pattern: newPattern.trim(),
            });
            setBills((prev) => [...(prev ?? []), created]);
            setNewName('');
            setNewAmount('');
            setNewDueDay('1');
            setNewPattern('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not create this bill');
        }
    }

    async function handleUpdate(bill: Bill, patch: Partial<Bill>) {
        setError(null);
        try {
            const updated = await billApiService.updateBill(bill.id, {
                name: patch.name ?? bill.name,
                amount_cents: patch.amount_cents ?? bill.amount_cents,
                due_day: patch.due_day ?? bill.due_day,
                match_pattern: patch.match_pattern ?? bill.match_pattern,
            });
            setBills((prev) => (prev ?? []).map((b) => b.id === bill.id ? updated : b));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not update this bill');
        }
    }

    async function handleDelete(id: number) {
        setError(null);
        try {
            await billApiService.deleteBill(id);
            setBills((prev) => (prev ?? []).filter((b) => b.id !== id));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete this bill');
        }
    }

    const visibleSuggestions = suggestions.filter(
        (s) => !dismissed.has(`${s.description} ${s.amount_cents}`)
    );

    return (
        <>
            <div className="bill-add">
                <input
                    type="text"
                    placeholder="Name (e.g. Netflix)"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                />
                <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                />
                <input
                    type="number"
                    min="1"
                    max="31"
                    placeholder="Due day"
                    value={newDueDay}
                    onChange={(e) => setNewDueDay(e.target.value)}
                />
                <input
                    type="text"
                    placeholder="Match pattern (optional)"
                    value={newPattern}
                    onChange={(e) => setNewPattern(e.target.value)}
                />
                <button type="button" onClick={handleAdd} disabled={newName.trim() === '' || newAmount.trim() === ''}>
                    Add bill
                </button>
            </div>

            {loading && <p className="ledger-status">Loading bills…</p>}
            {error && <p className="ledger-status error">{error}</p>}
            {!loading && !error && bills?.length === 0 && (
                <p className="ledger-status">No bills yet.</p>
            )}

            {!loading && !error && (bills ?? []).map((bill) => (
                <BillRow
                    key={bill.id}
                    bill={bill}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                />
            ))}

            {visibleSuggestions.length > 0 && (
                <section className="bill-suggestions" aria-label="Suggested bills">
                    <h2 className="bill-suggestions__title">Suggested bills</h2>
                    {visibleSuggestions.map((suggestion) => (
                        <article
                            className="ledger-row bill-suggestion-row"
                            key={`${suggestion.description} ${suggestion.amount_cents}`}
                        >
                            <span className="bill-suggestion-description">{suggestion.description}</span>
                            <span className="bill-suggestion-amount">{formatMoney(suggestion.amount_cents)}</span>
                            <span className="bill-suggestion-occurrences">
                                {suggestion.occurrences} occurrences
                            </span>
                            <button type="button" onClick={() => prefillFromSuggestion(suggestion)}>
                                Add as bill
                            </button>
                            <button type="button" onClick={() => dismissSuggestion(suggestion)}>
                                Dismiss
                            </button>
                        </article>
                    ))}
                </section>
            )}
        </>
    )
}

export default Bills
