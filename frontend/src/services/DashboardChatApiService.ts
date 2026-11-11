import {BaseApiService} from "./BaseApiService.ts";
import type {ChatMessage} from "../types/dashboardChat.ts";
import type {DashboardRange} from "../helpers/dashboardMetrics.ts";

export class DashboardChatApiService extends BaseApiService {
    constructor() {
        super('/dashboard/chat');
    }

    /**
     * Sends the full conversation so far plus the currently-selected
     * dashboard range, and returns the assistant's reply text.
     */
    async sendMessage(messages: ChatMessage[], range: DashboardRange): Promise<string> {
        const result = await this.create<{reply: string}>({messages, range});
        return result.reply;
    }
}

export const dashboardChatApiService = new DashboardChatApiService();
