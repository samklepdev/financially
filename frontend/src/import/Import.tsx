import {useState, type ChangeEvent} from "react";
import {importApiService} from "../services/ImportApiService.ts";
import type {ImportCandidate, NewTransaction} from "../types/transaction.ts";
import {formatMoney} from "../helpers/money.ts";
import "../styles/ledger.css"
import './Import.css'

type Candidate = ImportCandidate & {selected: boolean};

function toNewTransaction({selected, isDuplicate, ...t}: Candidate): NewTransaction {
    return t;
}

function Import() {
    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<string | null>(null);

    async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) {
            return;
        }

        setLoading(true);
        setError(null);
        setResult(null);
        setCandidates([]);

        try {
            const parsed = await importApiService.previewImport(file);
            setCandidates(parsed.map((c) => ({...c, selected: !c.isDuplicate})));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not parse this file');
        } finally {
            setLoading(false);
            e.target.value = '';
        }
    }

    function toggle(index: number) {
        setCandidates((prev) => prev.map((c, i) => i === index ? {...c, selected: !c.selected} : c));
    }

    async function handleConfirm() {
        setLoading(true);
        setError(null);

        const selected = candidates.filter((c) => c.selected).map(toNewTransaction);

        try {
            const created = await importApiService.confirmImport(selected);
            setResult(`Imported ${created} transaction${created === 1 ? '' : 's'}.`);
            setCandidates([]);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not import these transactions');
        } finally {
            setLoading(false);
        }
    }

    const selectedCount = candidates.filter((c) => c.selected).length;

    return (
        <>
            <div className="import-picker">
                <label className="import-file-label">
                    <input type="file" accept="application/pdf" onChange={handleFileChange} disabled={loading}/>
                    Choose a Cash App statement PDF
                </label>
            </div>

            {loading && <p className="ledger-status">Working…</p>}
            {error && <p className="ledger-status error">{error}</p>}
            {result && <p className="ledger-status">{result}</p>}

            {candidates.length > 0 && (
                <>
                    <div className="ledger">
                        {candidates.map((c, i) => (
                            <article className="ledger-row import-row" key={i}>
                                <input
                                    type="checkbox"
                                    checked={c.selected}
                                    onChange={() => toggle(i)}
                                    aria-label={`Include ${c.description}`}
                                />
                                <div className="ledger-row__main">
                                    <time className="ledger-date" dateTime={c.date}>{c.date}</time>
                                    <span className="ledger-desc">{c.description}</span>
                                    {c.isDuplicate && (
                                        <span className="ledger-category import-duplicate">Possible duplicate</span>
                                    )}
                                </div>
                                <div className="ledger-row__amount">
                                    <span className={`ledger-amount ${c.amount_cents < 0 ? 'debit' : 'credit'}`}>
                                        {formatMoney(c.amount_cents)}
                                    </span>
                                </div>
                            </article>
                        ))}
                    </div>
                    <button
                        type="button"
                        className="import-confirm"
                        onClick={handleConfirm}
                        disabled={loading || selectedCount === 0}
                    >
                        Import {selectedCount} transaction{selectedCount === 1 ? '' : 's'}
                    </button>
                </>
            )}
        </>
    )
}

export default Import
