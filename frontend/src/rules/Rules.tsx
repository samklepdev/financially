import {useEffect, useState} from "react";
import {categoryApiService} from "../services/CategoryApiService.ts";
import {categoryRuleApiService} from "../services/CategoryRuleApiService.ts";
import type {Category} from "../types/category.ts";
import type {CategoryRule} from "../types/categoryRule.ts";
import "../styles/ledger.css"
import './Rules.css'

function Rules() {
    const [rules, setRules] = useState<CategoryRule[]>();
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const [newPattern, setNewPattern] = useState('');
    const [newCategoryId, setNewCategoryId] = useState('');

    useEffect(() => {
        Promise.all([
            categoryRuleApiService.getAllCategoryRules(),
            categoryApiService.getAllCategories(),
        ]).then(([r, c]) => {
            setRules(r);
            setCategories(c);
            if (c.length > 0) {
                setNewCategoryId(String(c[0].id));
            }
        }).catch((err) => {
            setError(err.message);
        }).finally(() => {
            setLoading(false);
        });
    }, []);

    async function handleAdd() {
        if (newPattern.trim() === '' || newCategoryId === '') {
            return;
        }

        setError(null);
        try {
            const created = await categoryRuleApiService.createCategoryRule({
                pattern: newPattern.trim(),
                category_id: Number(newCategoryId),
            });
            setRules((prev) => [...(prev ?? []), created]);
            setNewPattern('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not create this rule');
        }
    }

    async function handleCategoryChange(rule: CategoryRule, value: string) {
        setError(null);
        try {
            const updated = await categoryRuleApiService.updateCategoryRule(rule.id, {
                pattern: rule.pattern,
                category_id: Number(value),
            });
            setRules((prev) => (prev ?? []).map((r) => r.id === rule.id ? updated : r));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not update this rule');
        }
    }

    async function handleDelete(id: number) {
        setError(null);
        try {
            await categoryRuleApiService.deleteCategoryRule(id);
            setRules((prev) => (prev ?? []).filter((r) => r.id !== id));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete this rule');
        }
    }

    return (
        <>
            <div className="rule-add">
                <input
                    type="text"
                    placeholder="Pattern (e.g. walmart)"
                    value={newPattern}
                    onChange={(e) => setNewPattern(e.target.value)}
                />
                <select value={newCategoryId} onChange={(e) => setNewCategoryId(e.target.value)}>
                    {categories.length === 0 && <option value="">No categories yet</option>}
                    {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={handleAdd}
                    disabled={newPattern.trim() === '' || newCategoryId === '' || categories.length === 0}
                >
                    Add rule
                </button>
            </div>

            {loading && <p className="ledger-status">Loading rules…</p>}
            {error && <p className="ledger-status error">{error}</p>}
            {!loading && !error && rules?.length === 0 && (
                <p className="ledger-status">No rules yet.</p>
            )}

            {!loading && !error && (rules ?? []).map((rule) => (
                <article className="ledger-row rule-row" key={rule.id}>
                    <span className="rule-pattern">{rule.pattern}</span>
                    <select
                        className="rule-category-select"
                        value={rule.category_id}
                        onChange={(e) => handleCategoryChange(rule, e.target.value)}
                    >
                        {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                    <button type="button" onClick={() => handleDelete(rule.id)}>Delete</button>
                </article>
            ))}
        </>
    )
}

export default Rules
