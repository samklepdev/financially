import {useEffect, useState} from "react";
import {billApiService} from "../services/BillApiService.ts";
import {categoryApiService} from "../services/CategoryApiService.ts";
import {transactionApiService} from "../services/TransactionApiService.ts";
import type {Bill, SuggestedBill, UpcomingBill} from "../types/bill.ts";
import type {Category} from "../types/category.ts";
import {formatMoney} from "../helpers/money.ts";
import BillRow from "./BillRow.tsx";
import NewCategoryBadge from "../rules/NewCategoryBadge.tsx";
import "../styles/ledger.css"
import './Bills.css'

const DEFAULT_COLOR = '#6b9478';

function Bills() {
    const [bills, setBills] = useState<Bill[]>();
    const [upcoming, setUpcoming] = useState<UpcomingBill[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [suggestions, setSuggestions] = useState<SuggestedBill[]>([]);
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const [newName, setNewName] = useState('');
    const [newAmount, setNewAmount] = useState('');
    const [newDueDay, setNewDueDay] = useState('1');
    const [newPattern, setNewPattern] = useState('');
    const [newCategoryId, setNewCategoryId] = useState<number | null>(null);
    const [proposedCategoryName, setProposedCategoryName] = useState<string | null>(null);
    const [aiSuggested, setAiSuggested] = useState(false);
    const [manuallySet, setManuallySet] = useState(false);
    const [suggesting, setSuggesting] = useState(false);
    const [prefilledFromSuggestion, setPrefilledFromSuggestion] = useState(false);

    useEffect(() => {
        Promise.all([
            billApiService.getAllBills(),
            billApiService.getSuggestedBills(),
            categoryApiService.getAllCategories(),
            billApiService.getUpcomingBills(),
        ]).then(([b, s, c, u]) => {
            setBills(b);
            setSuggestions(s);
            setCategories(c);
            setUpcoming(u);
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
        setPrefilledFromSuggestion(true);
    }

    function dismissSuggestion(suggestion: SuggestedBill) {
        setDismissed((prev) => new Set(prev).add(`${suggestion.description} ${suggestion.amount_cents}`));
    }

    async function handleNameBlur() {
        if (manuallySet || newName.trim() === '') {
            return;
        }
        setSuggesting(true);
        try {
            const suggestion = await transactionApiService.suggestCategory(newName.trim());
            setNewCategoryId(suggestion.category_id);
            setAiSuggested(suggestion.aiSuggested);
            setProposedCategoryName(suggestion.proposedCategoryName);
        } catch {
            setNewCategoryId(null);
            setAiSuggested(false);
            setProposedCategoryName(null);
        } finally {
            setSuggesting(false);
        }
    }

    function updateCategory(value: string) {
        setNewCategoryId(value === '' ? null : Number(value));
        setAiSuggested(false);
        setProposedCategoryName(null);
        setManuallySet(true);
    }

    function pickExistingInstead() {
        setProposedCategoryName(null);
        setManuallySet(true);
    }

    async function handleAdd() {
        const amountValue = Number(newAmount);
        const dueDayValue = Number(newDueDay);
        if (newName.trim() === '' || !Number.isFinite(amountValue) || amountValue <= 0) {
            return;
        }

        setError(null);
        try {
            let finalCategoryId = newCategoryId;
            if (proposedCategoryName) {
                const created = await categoryApiService.createCategory({
                    name: proposedCategoryName, color: DEFAULT_COLOR,
                });
                setCategories((prev) => [...prev, created]);
                finalCategoryId = created.id;
            }

            const created = await billApiService.createBill({
                name: newName.trim(),
                amount_cents: Math.round(amountValue * 100),
                due_day: dueDayValue,
                match_pattern: newPattern.trim(),
                deferred_until: null,
                category_id: finalCategoryId,
                marked_paid_for: null,
            });
            setBills((prev) => [...(prev ?? []), created]);
            setUpcoming(await billApiService.getUpcomingBills());
            setNewName('');
            setNewAmount('');
            setNewDueDay('1');
            setNewPattern('');
            setNewCategoryId(null);
            setProposedCategoryName(null);
            setAiSuggested(false);
            setManuallySet(false);
            setPrefilledFromSuggestion(false);
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
                deferred_until: 'deferred_until' in patch ? (patch.deferred_until ?? null) : bill.deferred_until,
                category_id: 'category_id' in patch ? (patch.category_id ?? null) : bill.category_id,
                marked_paid_for: 'marked_paid_for' in patch ? (patch.marked_paid_for ?? null) : bill.marked_paid_for,
            });
            setBills((prev) => (prev ?? []).map((b) => b.id === bill.id ? updated : b));
            // Any field here can shift this bill's current-cycle status (due_day
            // changes the cycle math, marked_paid_for/deferred_until change paid
            // status directly) — re-fetch rather than guess at the new status.
            setUpcoming(await billApiService.getUpcomingBills());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not update this bill');
        }
    }

    async function handleDelete(id: number) {
        setError(null);
        try {
            await billApiService.deleteBill(id);
            setBills((prev) => (prev ?? []).filter((b) => b.id !== id));
            setUpcoming((prev) => prev.filter((u) => u.bill.id !== id));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete this bill');
        }
    }

    const visibleSuggestions = suggestions.filter(
        (s) => !dismissed.has(`${s.description} ${s.amount_cents}`)
    );

    return (
        <>
            <div className="ledger-row bill-add">
                <label className="bill-field bill-field--grow">
                    <span className="bill-field__label">Name</span>
                    <input
                        type="text"
                        placeholder="e.g. Netflix"
                        value={newName}
                        onChange={(e) => {
                            setNewName(e.target.value);
                            if (e.target.value.trim() === '') {
                                setPrefilledFromSuggestion(false);
                            }
                        }}
                        onBlur={handleNameBlur}
                    />
                </label>
                <label className="bill-field">
                    <span className="bill-field__label">Amount</span>
                    <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="bill-amount-input"
                        placeholder="0.00"
                        value={newAmount}
                        onChange={(e) => setNewAmount(e.target.value)}
                    />
                </label>
                <label className="bill-field">
                    <span className="bill-field__label">Due day</span>
                    <input
                        type="number"
                        min="1"
                        max="31"
                        className="bill-due-day-input"
                        value={newDueDay}
                        onChange={(e) => setNewDueDay(e.target.value)}
                    />
                </label>
                <label className="bill-field">
                    <span className="bill-field__label">Match pattern</span>
                    <input
                        type="text"
                        placeholder="Optional"
                        value={newPattern}
                        onChange={(e) => setNewPattern(e.target.value)}
                    />
                </label>
                <label className="bill-field">
                    <span className="bill-field__label">
                        Category
                        {suggesting && <span className="import-ai-badge">Thinking…</span>}
                        {aiSuggested && !proposedCategoryName && <span className="import-ai-badge">AI guess</span>}
                    </span>
                    {proposedCategoryName ? (
                        <NewCategoryBadge
                            name={proposedCategoryName}
                            onRename={setProposedCategoryName}
                            onPickExisting={pickExistingInstead}
                        />
                    ) : (
                        <select
                            className="ledger-category-select"
                            value={newCategoryId ?? ''}
                            onChange={(e) => updateCategory(e.target.value)}
                        >
                            <option value="">Uncategorized</option>
                            {categories.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    )}
                </label>
                <button
                    type="button"
                    className="bill-add-submit"
                    onClick={handleAdd}
                    disabled={newName.trim() === '' || newAmount.trim() === ''}
                >
                    Add bill
                </button>
            </div>

            {prefilledFromSuggestion && (
                <p className="ledger-status bill-suggestion-hint">
                    This bill won't show as paid until you link its past transactions. Edit them on
                    the Transactions page and pick this bill from the dropdown.
                </p>
            )}

            {loading && <p className="ledger-status">Loading bills…</p>}
            {error && <p className="ledger-status error">{error}</p>}
            {!loading && !error && bills?.length === 0 && (
                <p className="ledger-status">No bills yet.</p>
            )}

            {!loading && !error && (bills ?? []).length > 0 && (
                <div className="ledger">
                    {(bills ?? []).map((bill) => (
                        <BillRow
                            key={bill.id}
                            bill={bill}
                            categories={categories}
                            upcoming={upcoming.find((u) => u.bill.id === bill.id)}
                            onUpdate={handleUpdate}
                            onDelete={handleDelete}
                        />
                    ))}
                </div>
            )}

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
