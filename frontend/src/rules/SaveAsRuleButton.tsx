import {useEffect, useState} from "react";
import {categoryRuleApiService} from "../services/CategoryRuleApiService.ts";
import './SaveAsRuleButton.css'

type Props = {
    description: string;
    categoryId: number | null;
};

/**
 * Lets a user turn "I just set this transaction's category" into a keyword
 * rule on the spot, so future imports with a similar description no longer
 * need manual categorization — without leaving for the separate Rules page.
 */
function SaveAsRuleButton({description, categoryId}: Props) {
    const [editing, setEditing] = useState(false);
    const [pattern, setPattern] = useState(description);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setSaved(false);
        setEditing(false);
        setError(null);
    }, [categoryId, description]);

    if (categoryId === null) {
        return null;
    }

    if (saved) {
        return <span className="save-as-rule-saved">Rule saved</span>;
    }

    if (!editing) {
        return (
            <button
                type="button"
                className="save-as-rule-button"
                onClick={() => {
                    setPattern(description);
                    setEditing(true);
                }}
            >
                + Save as rule
            </button>
        );
    }

    async function handleSave() {
        if (pattern.trim() === '') {
            return;
        }
        setError(null);
        try {
            await categoryRuleApiService.createCategoryRule({pattern: pattern.trim(), category_id: categoryId!});
            setSaved(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save this rule');
        }
    }

    return (
        <span className="save-as-rule-editor">
            <input
                type="text"
                className="save-as-rule-input"
                autoFocus
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        handleSave();
                    } else if (e.key === 'Escape') {
                        setEditing(false);
                    }
                }}
            />
            <button type="button" onClick={handleSave}>Save</button>
            <button type="button" onClick={() => setEditing(false)}>Cancel</button>
            {error && <span className="save-as-rule-error">{error}</span>}
        </span>
    );
}

export default SaveAsRuleButton
