import {useState} from "react";
import './NewCategoryBadge.css'

type Props = {
    name: string;
    onRename: (name: string) => void;
    onPickExisting: () => void;
};

/**
 * Shown on an import row where the AI proposed a brand-new category (no
 * existing category fit well). Lets the user rename it before confirming,
 * or fall back to picking a real existing category instead. Nothing is
 * created yet — this is preview-only until the import is confirmed.
 */
function NewCategoryBadge({name, onRename, onPickExisting}: Props) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(name);

    function save() {
        if (value.trim() === '') {
            return;
        }
        onRename(value.trim());
        setEditing(false);
    }

    if (editing) {
        return (
            <span className="new-category-editor">
                <input
                    type="text"
                    className="new-category-input"
                    autoFocus
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            save();
                        } else if (e.key === 'Escape') {
                            setValue(name);
                            setEditing(false);
                        }
                    }}
                />
                <button type="button" onClick={save}>Save</button>
                <button type="button" onClick={() => { setValue(name); setEditing(false); }}>Cancel</button>
            </span>
        );
    }

    return (
        <span className="new-category-badge">
            <button type="button" className="new-category-name" onClick={() => setEditing(true)}>
                New: {name}
            </button>
            <button type="button" className="new-category-pick-existing" onClick={onPickExisting}>
                pick existing instead
            </button>
        </span>
    );
}

export default NewCategoryBadge
