import {useEffect, useMemo, useState} from "react";
import type {Transaction} from "../types/transaction.ts";
import {transactionApiService} from "../services/TransactionApiService.ts";
import {formatMoney} from "../helpers/money.ts";
import {categoryLabel, monthKey, monthLabel} from "../helpers/ledger.ts";
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
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [month, setMonth] = useState<string>(ALL_MONTHS);
    const [category, setCategory] = useState<string>(ALL_CATEGORIES);

    useEffect(() => {
        transactionApiService.getAllTransactions().then((t) => {
            setTransactions(t)
        }).catch((err) => {
            setError(err.message)
        }).finally(() => {
            setLoading(false)
        })
    }, [])

    const sorted = useMemo(
        () => [...(transactions ?? [])].sort((a, b) => b.date.localeCompare(a.date)),
        [transactions]
    )

    const months = useMemo(() => {
        const keys = new Set(sorted.map((t) => monthKey(t.date)))
        return [...keys].sort().reverse()
    }, [sorted])

    const categories = useMemo(() => {
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
                        {categories.map((key) => (
                            <option key={key} value={key}>
                                {key === UNCATEGORIZED ? 'Uncategorized' : `Cat #${key}`}
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
                                        <span className="ledger-category">{categoryLabel(t.category_id)}</span>
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
