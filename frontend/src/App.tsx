import {useEffect, useMemo, useState} from "react";
import {transactionApiService} from "./services/TransactionApiService.ts";
import {categoryApiService} from "./services/CategoryApiService.ts";
import type {Transaction} from "./types/transaction.ts";
import type {Category} from "./types/category.ts";
import {formatMoney} from "./helpers/money.ts";
import {categoryName, monthKey, monthLabel, shiftMonth} from "./helpers/ledger.ts";
import RangeSelect from "./dashboard/RangeSelect.tsx";
import RunningBalanceChart from "./dashboard/charts/RunningBalanceChart.tsx";
import SpendingTrendChart from "./dashboard/charts/SpendingTrendChart.tsx";
import OutflowsDonut from "./dashboard/charts/OutflowsDonut.tsx";
import {runningBalanceSeries, spendingTrendSeries, outflowsByCategory, type DashboardRange} from "./helpers/dashboardMetrics.ts";
import "./styles/ledger.css"
import './App.css'

function App() {
    const [transactions, setTransactions] = useState<Transaction[]>();
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [month, setMonth] = useState<string>(() => monthKey(new Date().toISOString()));
    const [range, setRange] = useState<DashboardRange>('90d');

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

    useEffect(() => {
        categoryApiService.getAllCategories().then(setCategories).catch(() => {});
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

    const balanceSeries = useMemo(
        () => runningBalanceSeries(transactions ?? [], range),
        [transactions, range]
    );
    const spendSeries = useMemo(
        () => spendingTrendSeries(transactions ?? [], range),
        [transactions, range]
    );
    const outflows = useMemo(
        () => outflowsByCategory(transactions ?? [], categories, range),
        [transactions, categories, range]
    );

    return (
        <>
            <RangeSelect value={range} onChange={setRange}/>
            <section className="chart-grid" aria-label="Financial charts">
                <RunningBalanceChart data={balanceSeries}/>
                <SpendingTrendChart data={spendSeries}/>
                <OutflowsDonut data={outflows}/>
            </section>

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
                            <span className="ledger-category">{categoryName(categories, t.category_id)}</span>
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
