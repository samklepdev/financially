import {useEffect, useMemo, useState} from "react";
import {transactionApiService} from "./services/TransactionApiService.ts";
import type {Transaction} from "./types/transaction.ts";
import {formatMoney} from "./helpers/money.ts";
import {categoryLabel, monthKey, monthLabel, shiftMonth} from "./helpers/ledger.ts";
import "./styles/ledger.css"
import './App.css'

function App() {
    const [transactions, setTransactions] = useState<Transaction[]>();
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [month, setMonth] = useState<string>(() => monthKey(new Date().toISOString()));

    useEffect(() => {
        transactionApiService.getAllTransactions().then((t) => {
            setTransactions(t)
            if (t.length && !t.some((tx) => monthKey(tx.date) === month)) {
                setMonth(monthKey([...t].sort((a, b) => b.date.localeCompare(a.date))[0].date))
            }
        }).catch((err) => {
            setError(err.message)
        }).finally(() => {
            setLoading(false)
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const visible = useMemo(
        () => (transactions ?? [])
            .filter((t) => monthKey(t.date) === month)
            .sort((a, b) => b.date.localeCompare(a.date)),
        [transactions, month]
    )

    const totals = useMemo(() => {
        const credit = visible.filter((t) => t.amount_cents > 0).reduce((sum, t) => sum + t.amount_cents, 0)
        const debit = visible.filter((t) => t.amount_cents < 0).reduce((sum, t) => sum + t.amount_cents, 0)
        return {credit, debit, net: credit + debit}
    }, [visible])

    return (
        <>
            <div className="month-switch">
                <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">‹</button>
                <span className="month-label">{monthLabel(month)}</span>
                <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month">›</button>
            </div>

            <section className="stat-row" aria-label="Month summary">
                <article className="stat-tile">
                    <span className="stat-label">In</span>
                    <span className="stat-value credit">{formatMoney(totals.credit)}</span>
                </article>
                <article className="stat-tile">
                    <span className="stat-label">Out</span>
                    <span className="stat-value debit">{formatMoney(totals.debit)}</span>
                </article>
                <article className="stat-tile">
                    <span className="stat-label">Net</span>
                    <span className={`stat-value ${totals.net >= 0 ? 'credit' : 'debit'}`}>{formatMoney(totals.net)}</span>
                </article>
            </section>

            <section className="ledger" aria-label="Transactions">
                {loading && <p className="ledger-status">Loading transactions…</p>}
                {error && <p className="ledger-status error">Couldn't load transactions: {error}</p>}
                {!loading && !error && visible.length === 0 && (
                    <p className="ledger-status">Nothing logged for {monthLabel(month)}.</p>
                )}
                {!loading && !error && visible.map((t) => (
                    <article className="ledger-row" key={t.id}>
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
            </section>
        </>
    )
}

export default App
