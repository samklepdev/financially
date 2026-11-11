import {db} from "../config/db.ts";
import type {Category, NewCategory} from "../types/category.ts";

export class CategoryService {
    /**
     * Retrieves all categories from the database, ordered alphabetically by name.
     *
     * @return {Category[]} An array of categories sorted A-Z by name.
     */
    getAllCategories() {
        return db.prepare('SELECT * FROM categories ORDER BY name').all() as Category[];
    }

    /**
     * Retrieves a category by its unique identifier.
     *
     * @param id The unique identifier of the category to retrieve.
     * @return The matching category, or undefined if no category is found.
     */
    getCategoryById(id: number) {
        return db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Category | undefined;
    }

    /**
     * Creates a new category record in the database and returns the inserted category.
     *
     * @param category The category data to insert, including name and color.
     * @return The newly created category record.
     */
    createCategory(category: NewCategory) {
        return db.prepare('INSERT INTO categories (name, color) VALUES (?, ?) RETURNING *')
            .get(category.name, category.color) as Category;
    }

    /**
     * Updates an existing category record with the provided category data.
     *
     * @param id The unique identifier of the category to update.
     * @param category The new category data to apply.
     * @return The updated category record, or undefined if no category was updated.
     */
    updateCategory(id: number, category: NewCategory) {
        return db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ? RETURNING *')
            .get(category.name, category.color, id) as Category | undefined;
    }

    /**
     * Deletes a category with the specified identifier from the database.
     *
     * @param id The unique identifier of the category to delete.
     * @return The result of the delete operation, including the number of affected rows.
     */
    deleteCategory(id: number) {
        return db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    }
}
