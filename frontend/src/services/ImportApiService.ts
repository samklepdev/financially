import axios, {type AxiosInstance} from "axios";
import type {ApiErrorBody, ApiResponse} from "../types/api.ts";
import type {CsvRowError, ImportCandidate, ImportConfirmItem} from "../types/transaction.ts";

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
     * Uploads a CSV file plus a column mapping and returns the parsed
     * candidate transactions, along with any rows that failed to parse.
     * Writes nothing to the database.
     */
    async previewCsvImport(
        file: File, mapping: {dateColumn: string, descriptionColumn: string, amountColumn: string}
    ): Promise<{transactions: ImportCandidate[], errors: CsvRowError[]}> {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('dateColumn', mapping.dateColumn);
        formData.append('descriptionColumn', mapping.descriptionColumn);
        formData.append('amountColumn', mapping.amountColumn);

        try {
            const res = await this.http.post<ApiResponse<{transactions: ImportCandidate[], errors: CsvRowError[]}>>(
                '/transactions/import/csv/preview', formData
            );
            return res.data.data;
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
    async confirmImport(transactions: ImportConfirmItem[]): Promise<number> {
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
