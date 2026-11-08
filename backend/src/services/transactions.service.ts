import {db} from "../config/db.ts";
import type {NewTransaction, Transaction} from "../types/transaction.ts";

export class TransactionService {
    /**
     * Retrieves all transactions from the database, ordered by date in descending order and then by ID in descending order.
     *
     * @return {Transaction[]} An array of transactions sorted from newest to oldest.
     */
      getAllTransactions() {
        const transactions = db.prepare('SELECT * FROM transactions ORDER BY date DESC, id DESC').all() as Transaction[];
          return transactions;
    }

    /**
     * Retrieves a transaction by its unique identifier.
     *
     * @param id The unique identifier of the transaction to retrieve.
     * @return The matching transaction, or undefined if no transaction is found.
     */
    getTransactionById(id: number) {
          const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Transaction | undefined;
          return transaction;
    }

    /**
     * Creates a new transaction record in the database and returns the inserted transaction.
     *
     * @param transaction - The transaction data to insert, including date, description, amount_cents, category_id, and bill_id.
     * @return The newly created transaction record.
     */
    createTransaction(transaction: any) {
          const newTransaction = db.prepare(`INSERT INTO transactions (date, description, amount_cents, category_id, bill_id)
                VALUES (?, ?, ?, ?, ?) RETURNING *`)
              .get(transaction.date, transaction.description, transaction.amount_cents, transaction.category_id, transaction.bill_id) as Transaction;
          return newTransaction;
    }

    /**
     * Updates an existing transaction record with the provided transaction data.
     *
     * @param transaction The transaction data containing the updated date, description, amount_cents, category_id, bill_id, and transaction id.
     * @return The updated transaction record, or undefined if no transaction was updated.
     */
    updateTransaction(id: number, t: NewTransaction): Transaction | undefined {
        return db
            .prepare(`UPDATE transactions
                  SET date = ?, description = ?, amount_cents = ?, category_id = ?, bill_id = ?
                  WHERE id = ?
                  RETURNING *`)
            .get(t.date, t.description, t.amount_cents, t.category_id, t.bill_id, id) as Transaction | undefined;
    }

    /**
     * Deletes a transaction with the specified identifier from the database.
     *
     * @param id The unique identifier of the transaction to delete.
     * @return The result of the delete operation, including information such as the number of affected rows.
     */
    deleteTransaction(id: number) {
          const toDelete = db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
          return toDelete;
    }
}