import type {Request, Response} from 'express';
import {askDashboardAssistant} from "../services/dashboardChat.service.ts";
import type {ChatMessage, DashboardRange} from "../types/dashboardChat.ts";

const VALID_RANGES: DashboardRange[] = ['30d', '90d', '1y', 'all'];

function isValidMessages(value: unknown): value is ChatMessage[] {
    return Array.isArray(value) && value.length > 0 && value.every((m) =>
        typeof m === 'object' && m !== null &&
        ((m as Record<string, unknown>).role === 'user' || (m as Record<string, unknown>).role === 'assistant') &&
        typeof (m as Record<string, unknown>).content === 'string' &&
        (m as Record<string, unknown>).content !== ''
    );
}

/**
 * Validates the chat request body, asks the local Ollama model for a
 * reply grounded in the user's transactions for the given range, and
 * returns it. Responds 502 with a plain-language error if Ollama can't
 * be reached.
 */
export async function postChatMessage(req: Request, res: Response) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const {messages, range} = body;

    if (!isValidMessages(messages)) {
        return res.status(400).json({error: 'messages must be a non-empty array of {role, content}'});
    }

    if (typeof range !== 'string' || !VALID_RANGES.includes(range as DashboardRange)) {
        return res.status(400).json({error: `range must be one of ${VALID_RANGES.join(', ')}`});
    }

    try {
        const reply = await askDashboardAssistant(messages, range as DashboardRange);
        return res.status(200).json({data: {reply}});
    } catch {
        return res.status(502).json({error: "Can't reach the local AI model. Make sure Ollama is running."});
    }
}
