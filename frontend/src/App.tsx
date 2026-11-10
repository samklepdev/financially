import './App.css'
import {useEffect, useState} from "react";
import {transactionApiService} from "./services/TransactionApiService.ts";
import type {Transaction} from "./types/transaction.ts";
import {formatMoney} from "./helpers/money.ts";

function App() {
    const [transactions, setTransactions] = useState<Transaction[]>();
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        transactionApiService.getAllTransactions().then((t) => {
            setTransactions(t)
        }).catch((err) => {
            setError(err.message)
        }).finally(() => {
            setLoading(false)
        })
    }, [])

    return (
        <>
            <h1>Dashboard</h1>
            <h2>Transactions</h2>
            {loading && <p>Loading...</p>}
            {error && <p>{error}</p>}
            <table>
                <th>
                    <tr>
                        <th>
                            Date
                        </th>
                        <th>
                            Description
                        </th>
                        <th>
                            Amount
                        </th>
                        <th>
                            Category
                        </th>
                    </tr>
                </th>
                <tbody>
                {transactions?.map((t) => (
                    <tr key={t.id}>
                        <td>
                            {t.date}
                        </td>
                        <td>
                            {t.description}
                        </td>
                        <td>
                            {formatMoney(t.amount_cents)}
                        </td>
                        <td>
                            {t.category_id}
                        </td>
                    </tr>
                ))}
                </tbody>
            </table>
        </>
    )
}

export default App
