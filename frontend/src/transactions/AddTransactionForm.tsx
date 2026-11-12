import {useState, type FormEvent} from "react";
import type {Category} from "../types/category.ts";
import type {Bill} from "../types/bill.ts";
import type {NewTransaction, Transaction} from "../types/transaction.ts";
import {transactionApiService} from "../services/TransactionApiService.ts";
import {categoryApiService} from "../services/CategoryApiService.ts";
import NewCategoryBadge from "../rules/NewCategoryBadge.tsx";
import "../styles/ledger.css"
import './AddTransactionForm.css'

const DEFAULT_COLOR = '#6b9478';
const EXPENSE = 'expense';
const INCOME = 'income';

function todayDate(): string {
    return new Date().toISOString().slice(0, 10);
}

type Props = {
    categories: Category[];
    bills: Bill[];
    onCreated: (t: Transaction) => void;
    onCategoryCreated: (c: Category) => void;
    onCancel: () => void;
};

function AddTransactionForm({categories, bills, onCreated, onCategoryCreated, onCancel}: Props) {
    const [date, setDate] = useState(todayDate());
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [amountType, setAmountType] = useState<typeof EXPENSE | typeof INCOME>(EXPENSE);
    const [categoryId, setCategoryId] = useState<number | null>(null);
    const [billId, setBillId] = useState<number | null>(null);
    const [proposedCategoryName, setProposedCategoryName] = useState<string | null>(null);
    const [aiSuggested, setAiSuggested] = useState(false);
    const [manuallySet, setManuallySet] = useState(false);
    const [suggesting, setSuggesting] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleDescriptionBlur() {
        if (manuallySet || description.trim() === '') {
            return;
        }
        setSuggesting(true);
        try {
            const suggestion = await transactionApiService.suggestCategory(description.trim());
            setCategoryId(suggestion.category_id);
            setBillId(suggestion.bill_id);
            setAiSuggested(suggestion.aiSuggested);
            setProposedCategoryName(suggestion.proposedCategoryName);
        } catch {
            setCategoryId(null);
            setBillId(null);
            setAiSuggested(false);
            setProposedCategoryName(null);
        } finally {
            setSuggesting(false);
        }
    }

    function updateCategory(value: string) {
        setCategoryId(value === '' ? null : Number(value));
        setAiSuggested(false);
        setProposedCategoryName(null);
        setManuallySet(true);
    }

    function pickExistingInstead() {
        setProposedCategoryName(null);
        setManuallySet(true);
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();

        const amountValue = Number(amount);
        if (description.trim() === '' || !Number.isFinite(amountValue) || amountValue <= 0) {
            setError('Enter a description and a positive amount');
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            let finalCategoryId = categoryId;
            if (proposedCategoryName) {
                const created = await categoryApiService.createCategory({
                    name: proposedCategoryName, color: DEFAULT_COLOR,
                });
                onCategoryCreated(created);
                finalCategoryId = created.id;
            }

            const amount_cents = Math.round(amountValue * 100) * (amountType === EXPENSE ? -1 : 1);
            const newTransaction: NewTransaction = {
                date, description: description.trim(), amount_cents, category_id: finalCategoryId, bill_id: billId,
            };
            const created = await transactionApiService.createTransaction(newTransaction);
            onCreated(created);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not create this transaction');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form className="ledger-row add-transaction-form" onSubmit={handleSubmit}>
            <div className="ledger-row__main add-transaction-fields">
                <input
                    type="date"
                    className="add-transaction-date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                />
                <input
                    type="text"
                    className="add-transaction-description"
                    placeholder="Description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={handleDescriptionBlur}
                    required
                />
                {suggesting && <span className="import-ai-badge">Thinking…</span>}
                {proposedCategoryName ? (
                    <NewCategoryBadge
                        name={proposedCategoryName}
                        onRename={setProposedCategoryName}
                        onPickExisting={pickExistingInstead}
                    />
                ) : (
                    <select
                        className="ledger-category-select"
                        value={categoryId ?? ''}
                        onChange={(e) => updateCategory(e.target.value)}
                    >
                        <option value="">Uncategorized</option>
                        {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                )}
                {aiSuggested && !proposedCategoryName && <span className="import-ai-badge">AI guess</span>}
                <select
                    className="ledger-category-select"
                    value={billId ?? ''}
                    onChange={(e) => setBillId(e.target.value === '' ? null : Number(e.target.value))}
                >
                    <option value="">No bill</option>
                    {bills.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                </select>
            </div>
            <div className="add-transaction-amount">
                <select
                    className="ledger-category-select"
                    value={amountType}
                    onChange={(e) => setAmountType(e.target.value as typeof EXPENSE | typeof INCOME)}
                >
                    <option value={EXPENSE}>Expense</option>
                    <option value={INCOME}>Income</option>
                </select>
                <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="add-transaction-amount-input"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                />
                <button type="submit" className="add-transaction-submit" disabled={submitting}>
                    {submitting ? 'Adding…' : 'Add'}
                </button>
                <button type="button" className="add-transaction-cancel" onClick={onCancel} disabled={submitting}>
                    Cancel
                </button>
            </div>
            {error && <p className="ledger-status error add-transaction-error">{error}</p>}
        </form>
    );
}

export default AddTransactionForm
