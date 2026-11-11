import {useEffect, useMemo, useState} from "react";
import type {Transaction} from "../types/transaction.ts";
import type {Category} from "../types/category.ts";
import {transactionApiService} from "../services/TransactionApiService.ts";
import {categoryApiService} from "../services/CategoryApiService.ts";
import {formatMoney} from "../helpers/money.ts";
import {categoryName, monthKey, monthLabel} from "../helpers/ledger.ts";
import SaveAsRuleButton from "../rules/SaveAsRuleButton.tsx";
import AddTransactionForm from "./AddTransactionForm.tsx";
import "../styles/ledger.css"
import './Transactions.css'

const ALL_MONTHS = 'all';
const ALL_CATEGORIES = 'all';
const UNCATEGORIZED = 'uncategorized';

function categoryFilterKey(categoryId: number | null): string {
    return categoryId === null ? UNCATEGORIZED : String(categoryId);
}

function Transactions() {
    const [transactions, setTransactions] = useState<Transaction[]>();
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [month, setMonth] = useState<string>(ALL_MONTHS);
    const [category, setCategory] = useState<string>(ALL_CATEGORIES);
    const [editingCategoryFor, setEditingCategoryFor] = useState<number | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);

    useEffect(() => {
        transactionApiService.getAllTransactions().then((t) => {
            setTransactions(t)
        }).catch((err) => {
            setError(err.message)
        }).finally(() => {
            setLoading(false)
        })
    }, [])

    useEffect(() => {
        categoryApiService.getAllCategories().then(setCategories).catch(() => {});
    }, [])

    async function handleCategoryChange(t: Transaction, value: string) {
        const category_id = value === '' ? null : Number(value);
        setEditingCategoryFor(null);
        setError(null);
        try {
            const updated = await transactionApiService.updateTransaction(t.id, {
                date: t.date,
                description: t.description,
                amount_cents: t.amount_cents,
                category_id,
                bill_id: t.bill_id,
            });
            setTransactions((prev) => (prev ?? []).map((tx) => tx.id === t.id ? updated : tx));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not update this transaction's category");
        }
    }

    function handleTransactionCreated(t: Transaction) {
        setTransactions((prev) => [...(prev ?? []), t]);
        setShowAddForm(false);
    }

    function handleCategoryCreated(c: Category) {
        setCategories((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)));
    }

    const sorted = useMemo(
        () => [...(transactions ?? [])].sort((a, b) => b.date.localeCompare(a.date)),
        [transactions]
    )

    const months = useMemo(() => {
        const keys = new Set(sorted.map((t) => monthKey(t.date)))
        return [...keys].sort().reverse()
    }, [sorted])

    const categoryFilterKeys = useMemo(() => {
        const keys = new Set(sorted.map((t) => categoryFilterKey(t.category_id)))
        return [...keys].sort()
    }, [sorted])

    const filtered = useMemo(
        () => sorted.filter((t) =>
            (month === ALL_MONTHS || monthKey(t.date) === month) &&
            (category === ALL_CATEGORIES || categoryFilterKey(t.category_id) === category)
        ),
        [sorted, month, category]
    )

    const grouped = useMemo(() => {
        const groups: {key: string, items: Transaction[]}[] = []
        for (const t of filtered) {
            const key = monthKey(t.date)
            const current = groups.at(-1)
            if (current?.key === key) {
                current.items.push(t)
            } else {
                groups.push({key, items: [t]})
            }
        }
        return groups
    }, [filtered])

    return (
        <>
            <div className="ledger-toolbar">
                <button type="button" className="ledger-add-button" onClick={() => setShowAddForm(true)}>
                    + Add transaction
                </button>
            </div>

            {showAddForm && (
                <AddTransactionForm
                    categories={categories}
                    onCreated={handleTransactionCreated}
                    onCategoryCreated={handleCategoryCreated}
                    onCancel={() => setShowAddForm(false)}
                />
            )}

            <div className="ledger-filters">
                <label className="ledger-filter">
                    <span>Month</span>
                    <select value={month} onChange={(e) => setMonth(e.target.value)}>
                        <option value={ALL_MONTHS}>All time</option>
                        {months.map((key) => (
                            <option key={key} value={key}>{monthLabel(key)}</option>
                        ))}
                    </select>
                </label>
                <label className="ledger-filter">
                    <span>Category</span>
                    <select value={category} onChange={(e) => setCategory(e.target.value)}>
                        <option value={ALL_CATEGORIES}>All categories</option>
                        {categoryFilterKeys.map((key) => (
                            <option key={key} value={key}>
                                {key === UNCATEGORIZED ? 'Uncategorized' : categoryName(categories, Number(key))}
                            </option>
                        ))}
                    </select>
                </label>
                <span className="ledger-count">
                    {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
                </span>
            </div>

            {loading && <p className="ledger-status">Loading transactions…</p>}
            {error && <p className="ledger-status error">Couldn't load transactions: {error}</p>}
            {!loading && !error && filtered.length === 0 && (
                <p className="ledger-status">No transactions match these filters.</p>
            )}

            {!loading && !error && grouped.map(({key, items}, groupIndex) => {
                const precedingCount = grouped.slice(0, groupIndex).reduce((sum, g) => sum + g.items.length, 0)
                return (
                    <section className="ledger-group" key={key} aria-label={monthLabel(key)}>
                        <h2 className="ledger-group__label">{monthLabel(key)}</h2>
                        <div className="ledger">
                            {items.map((t, i) => (
                                <article className="ledger-row" key={t.id}>
                                    <span className="ledger-index">{precedingCount + i + 1}</span>
                                    <div className="ledger-row__main">
                                        <time className="ledger-date" dateTime={t.date}>{t.date}</time>
                                        <span className="ledger-desc">{t.description}</span>
                                        {editingCategoryFor === t.id ? (
                                            <select
                                                className="ledger-category-select"
                                                autoFocus
                                                value={t.category_id ?? ''}
                                                onChange={(e) => handleCategoryChange(t, e.target.value)}
                                                onBlur={() => setEditingCategoryFor(null)}
                                            >
                                                <option value="">Uncategorized</option>
                                                {categories.map((c) => (
                                                    <option key={c.id} value={c.id}>{c.name}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <button
                                                type="button"
                                                className="ledger-category ledger-category-button"
                                                onClick={() => setEditingCategoryFor(t.id)}
                                            >
                                                {categoryName(categories, t.category_id)}
                                            </button>
                                        )}
                                        <SaveAsRuleButton description={t.description} categoryId={t.category_id}/>
                                    </div>
                                    <div className="ledger-row__amount">
                                        <span className={`ledger-amount ${t.amount_cents < 0 ? 'debit' : 'credit'}`}>
                                            {formatMoney(t.amount_cents)}
                                        </span>
                                        <span className="ledger-cents">{t.amount_cents}¢</span>
                                    </div>
                                </article>
                            ))}
                        </div>
                    </section>
                )
            })}
        </>
    )
}

export default Transactions
