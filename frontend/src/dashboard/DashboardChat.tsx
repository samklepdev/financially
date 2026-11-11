import {useState} from "react";
import type {ChatMessage} from "../types/dashboardChat.ts";
import type {DashboardRange} from "../helpers/dashboardMetrics.ts";
import {dashboardChatApiService} from "../services/DashboardChatApiService.ts";
import './dashboard.css';

type Props = {range: DashboardRange};

const FALLBACK_ERROR = "Can't reach the local AI model. Make sure Ollama is running.";

function DashboardChat({range}: Props) {
    const [open, setOpen] = useState(() => window.innerWidth > 640);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);

    async function handleSend() {
        const content = draft.trim();
        if (content === '' || sending) {
            return;
        }

        const next: ChatMessage[] = [...messages, {role: 'user', content}];
        setMessages(next);
        setDraft('');
        setSending(true);

        try {
            const reply = await dashboardChatApiService.sendMessage(next, range);
            setMessages((prev) => [...prev, {role: 'assistant', content: reply}]);
        } catch (err) {
            const message = err instanceof Error ? err.message : FALLBACK_ERROR;
            setMessages((prev) => [...prev, {role: 'assistant', content: message}]);
        } finally {
            setSending(false);
        }
    }

    if (!open) {
        return (
            <button
                type="button"
                className="chat-toggle chat-toggle--closed"
                onClick={() => setOpen(true)}
                aria-label="Open assistant"
            >
                💬
            </button>
        );
    }

    return (
        <aside className="dashboard-chat" aria-label="Financial assistant">
            <div className="dashboard-chat__header">
                <span>Assistant</span>
                <button type="button" className="chat-toggle" onClick={() => setOpen(false)} aria-label="Close assistant">
                    ×
                </button>
            </div>
            <div className="dashboard-chat__messages">
                {messages.length === 0 && (
                    <p className="dashboard-chat__empty">Ask about your spending, savings, or where to cut back.</p>
                )}
                {messages.map((m, i) => (
                    <p key={i} className={`chat-bubble chat-bubble--${m.role}`}>{m.content}</p>
                ))}
                {sending && <p className="chat-bubble chat-bubble--assistant chat-bubble--pending">Thinking…</p>}
            </div>
            <form
                className="dashboard-chat__input"
                onSubmit={(e) => {
                    e.preventDefault();
                    void handleSend();
                }}
            >
                <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Ask anything…"
                    disabled={sending}
                />
                <button type="submit" disabled={sending || draft.trim() === ''}>Send</button>
            </form>
        </aside>
    );
}

export default DashboardChat;
