import {useEffect, useState} from "react";
import type {Transaction} from "../types/transaction.ts";
import {transactionApiService} from "../services/TransactionApiService.ts";

function Transactions() {
    const [transactions, setTransactions] = useState<Transaction[]>();
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true)
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
            <h1>Transactions</h1>
            {loading && <p>Loading...</p>}
            {error && <p>{error}</p>}
            {transactions?.map((t) => (
                <>
                    <li key={t.id}>
                        {t.date}
                    </li>
                    <li>
                        {t.description}
                    </li>
                    <li>
                        {t.amount_cents}
                    </li>
                    <li>
                        {t.category_id}
                    </li>
                    <li>
                        {t.bill_id}
                    </li>
                </>
            ))}
        </>
    )
}

export default Transactions