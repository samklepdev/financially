import {useEffect, useState} from "react";
import {categoryApiService} from "../services/CategoryApiService.ts";
import type {Category} from "../types/category.ts";
import "../styles/ledger.css"
import './Categories.css'

const DEFAULT_COLOR = '#6b9478';

function Categories() {
    const [categories, setCategories] = useState<Category[]>();
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const [newName, setNewName] = useState('');
    const [newColor, setNewColor] = useState(DEFAULT_COLOR);

    const [editingId, setEditingId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');
    const [editColor, setEditColor] = useState(DEFAULT_COLOR);

    useEffect(() => {
        categoryApiService.getAllCategories().then((c) => {
            setCategories(c);
        }).catch((err) => {
            setError(err.message);
        }).finally(() => {
            setLoading(false);
        });
    }, []);

    async function handleAdd() {
        if (newName.trim() === '') {
            return;
        }

        setError(null);
        try {
            const created = await categoryApiService.createCategory({name: newName.trim(), color: newColor});
            setCategories((prev) => [...(prev ?? []), created].sort((a, b) => a.name.localeCompare(b.name)));
            setNewName('');
            setNewColor(DEFAULT_COLOR);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not create this category');
        }
    }

    function startEdit(category: Category) {
        setEditingId(category.id);
        setEditName(category.name);
        setEditColor(category.color);
    }

    async function handleSaveEdit(id: number) {
        if (editName.trim() === '') {
            return;
        }

        setError(null);
        try {
            const updated = await categoryApiService.updateCategory(id, {name: editName.trim(), color: editColor});
            setCategories((prev) => (prev ?? []).map((c) => c.id === id ? updated : c));
            setEditingId(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not update this category');
        }
    }

    async function handleDelete(id: number) {
        setError(null);
        try {
            await categoryApiService.deleteCategory(id);
            setCategories((prev) => (prev ?? []).filter((c) => c.id !== id));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete this category');
        }
    }

    return (
        <>
            <div className="category-add">
                <input
                    type="color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    aria-label="New category color"
                />
                <input
                    type="text"
                    placeholder="New category name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                />
                <button type="button" onClick={handleAdd} disabled={newName.trim() === ''}>
                    Add category
                </button>
            </div>

            {loading && <p className="ledger-status">Loading categories…</p>}
            {error && <p className="ledger-status error">{error}</p>}
            {!loading && !error && categories?.length === 0 && (
                <p className="ledger-status">No categories yet.</p>
            )}

            {!loading && !error && (categories ?? []).length > 0 && (
                <div className="ledger">
                    {(categories ?? []).map((category) => (
                        <article className="ledger-row category-row" key={category.id}>
                            {editingId === category.id ? (
                                <>
                                    <input
                                        type="color"
                                        value={editColor}
                                        onChange={(e) => setEditColor(e.target.value)}
                                        aria-label={`Edit color for ${category.name}`}
                                    />
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        aria-label={`Edit name for ${category.name}`}
                                    />
                                    <div className="category-row__actions">
                                        <button type="button" onClick={() => handleSaveEdit(category.id)}>Save</button>
                                        <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <span className="category-swatch" style={{backgroundColor: category.color}}/>
                                    <span className="category-name">{category.name}</span>
                                    <div className="category-row__actions">
                                        <button type="button" onClick={() => startEdit(category)}>Edit</button>
                                        <button type="button" onClick={() => handleDelete(category.id)}>Delete</button>
                                    </div>
                                </>
                            )}
                        </article>
                    ))}
                </div>
            )}
        </>
    )
}

export default Categories
