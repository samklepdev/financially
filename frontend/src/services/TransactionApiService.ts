import axios from "axios";
import type {ApiErrorBody, ApiResponse} from "../types/api.ts";
import {BaseApiService} from "./BaseApiService.ts";
import type {CategorySuggestion, NewTransaction, Transaction} from "../types/transaction.ts";

export class TransactionApiService extends BaseApiService {

    constructor() {
        super('/transactions');
    }

    /**
     * Retrieves all transactions.
     *
     * @return A promise that resolves to an array of transactions.
     */
    getAllTransactions(): Promise<Transaction[]> {
        return this.getAll<Transaction[]>();
    }

    /**
     * Retrieves a transaction by its unique identifier.
     *
     * @param id The unique identifier of the transaction to retrieve.
     * @return A promise that resolves to the matching transaction.
     */
    getTransactionById(id: string): Promise<Transaction> {
        return this.getById<Transaction>(id)
    }

    /**
     * Creates a new transaction using the provided transaction data.
     *
     * @param body The transaction data used to create the transaction.
     * @return A promise that resolves to the created transaction.
     */
    createTransaction(body: NewTransaction): Promise<Transaction> {
        return this.create<Transaction>(body);
    }

    /**
     * Asks the backend to suggest a category for a transaction description,
     * for the manual add-transaction form. Resolves to {category_id: null,
     * aiSuggested: false, proposedCategoryName: null} when nothing could be
     * suggested — only a genuine request failure (network/auth/server error)
     * rejects.
     *
     * @param description The transaction description to suggest a category for.
     * @return A promise that resolves to the suggested category.
     */
    async suggestCategory(description: string): Promise<CategorySuggestion> {
        try {
            const res = await this.http.post<ApiResponse<CategorySuggestion>>(
                `${this.path}/suggest-category`, {description}
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
     * Updates an existing transaction with the provided transaction data.
     *
     * @param id The unique identifier of the transaction to update.
     * @param body The new transaction data to apply.
     * @return A promise that resolves to the updated transaction.
     */
    updateTransaction(id: number, body: NewTransaction): Promise<Transaction> {
        return this.update<Transaction>(id, body)
    }

    /**
     * Deletes a transaction by its identifier.
     *
     * @param id The identifier of the transaction to delete.
     * @return A promise that resolves when the transaction has been deleted.
     */
    async deleteTransaction(id: number): Promise<void> {
        return this.delete(id)
    }
}

export const transactionApiService = new TransactionApiService()