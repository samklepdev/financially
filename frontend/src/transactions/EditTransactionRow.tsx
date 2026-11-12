import {useState, type FormEvent} from "react";
import type {Category} from "../types/category.ts";
import type {Bill} from "../types/bill.ts";
import type {Transaction} from "../types/transaction.ts";
import {transactionApiService} from "../services/TransactionApiService.ts";
import "../styles/ledger.css"
import './AddTransactionForm.css'

const EXPENSE = 'expense';
const INCOME = 'income';

type Props = {
    transaction: Transaction;
    categories: Category[];
    bills: Bill[];
    onSaved: (t: Transaction) => void;
    onDeleted: (id: number) => void;
    onCancel: () => void;
};

function EditTransactionRow({transaction, categories, bills, onSaved, onDeleted, onCancel}: Props) {
    const [date, setDate] = useState(transaction.date);
    const [description, setDescription] = useState(transaction.description);
    const [amount, setAmount] = useState((Math.abs(transaction.amount_cents) / 100).toFixed(2));
    const [amountType, setAmountType] = useState<typeof EXPENSE | typeof INCOME>(
        transaction.amount_cents < 0 ? EXPENSE : INCOME
    );
    const [categoryId, setCategoryId] = useState<number | null>(transaction.category_id);
    const [billId, setBillId] = useState<number | null>(transaction.bill_id);
    const [submitting, setSubmitting] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSave(e: FormEvent) {
        e.preventDefault();

        const amountValue = Number(amount);
        if (description.trim() === '' || !Number.isFinite(amountValue) || amountValue <= 0) {
            setError('Enter a description and a positive amount');
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            const amount_cents = Math.round(amountValue * 100) * (amountType === EXPENSE ? -1 : 1);
            const updated = await transactionApiService.updateTransaction(transaction.id, {
                date, description: description.trim(), amount_cents, category_id: categoryId, bill_id: billId,
            });
            onSaved(updated);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save this transaction');
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDelete() {
        if (!confirmingDelete) {
            setConfirmingDelete(true);
            return;
        }

        setDeleting(true);
        setError(null);
        try {
            await transactionApiService.deleteTransaction(transaction.id);
            onDeleted(transaction.id);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete this transaction');
            setDeleting(false);
            setConfirmingDelete(false);
        }
    }

    return (
        <form className="ledger-row add-transaction-form" onSubmit={handleSave}>
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
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    required
                />
                <select
                    className="ledger-category-select"
                    value={categoryId ?? ''}
                    onChange={(e) => setCategoryId(e.target.value === '' ? null : Number(e.target.value))}
                >
                    <option value="">Uncategorized</option>
                    {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
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
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                />
                <button type="submit" className="add-transaction-submit" disabled={submitting || deleting}>
                    {submitting ? 'Saving…' : 'Save'}
                </button>
                <button
                    type="button"
                    className="add-transaction-cancel"
                    onClick={onCancel}
                    disabled={submitting || deleting}
                >
                    Cancel
                </button>
                <button
                    type="button"
                    className={`add-transaction-cancel transaction-delete-button ${confirmingDelete ? 'transaction-delete-button--confirming' : ''}`}
                    onClick={handleDelete}
                    disabled={submitting || deleting}
                >
                    {deleting ? 'Deleting…' : confirmingDelete ? 'Confirm delete?' : 'Delete'}
                </button>
            </div>
            {error && <p className="ledger-status error add-transaction-error">{error}</p>}
        </form>
    );
}

export default EditTransactionRow
