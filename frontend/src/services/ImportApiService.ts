import axios, {type AxiosInstance} from "axios";
import type {ApiErrorBody, ApiResponse} from "../types/api.ts";
import type {ImportCandidate} from "../types/transaction.ts";
import type {NewTransaction} from "../types/transaction.ts";

export class ImportApiService {
    private readonly http: AxiosInstance = axios.create({
        baseURL: import.meta.env.VITE_BASE_API_URL,
        withCredentials: true,
    })

    /**
     * Uploads a PDF statement and returns the parsed candidate transactions.
     * Writes nothing to the database.
     */
    async previewImport(file: File): Promise<ImportCandidate[]> {
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await this.http.post<ApiResponse<{transactions: ImportCandidate[]}>>(
                '/transactions/import/preview', formData
            );
            return res.data.data.transactions;
        } catch (error) {
            if (axios.isAxiosError<ApiErrorBody>(error)) {
                throw new Error(error.response?.data?.error ?? error.message, {cause: error});
            }
            throw error;
        }
    }

    /**
     * Validates and inserts a confirmed batch of transactions.
     *
     * @return The number of transactions created.
     */
    async confirmImport(transactions: NewTransaction[]): Promise<number> {
        try {
            const res = await this.http.post<ApiResponse<{created: number}>>(
                '/transactions/import', {transactions}
            );
            return res.data.data.created;
        } catch (error) {
            if (axios.isAxiosError<ApiErrorBody>(error)) {
                throw new Error(error.response?.data?.error ?? error.message, {cause: error});
            }
            throw error;
        }
    }
}

export const importApiService = new ImportApiService();
