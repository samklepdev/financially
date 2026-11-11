import {db} from "../config/db.ts";
import type {CategoryRule, NewCategoryRule} from "../types/categoryRule.ts";

export class CategoryRuleService {
    /**
     * Retrieves all category rules from the database, ordered alphabetically by pattern.
     *
     * @return {CategoryRule[]} An array of category rules sorted A-Z by pattern.
     */
    getAllCategoryRules() {
        return db.prepare('SELECT * FROM category_rules ORDER BY pattern').all() as CategoryRule[];
    }

    /**
     * Retrieves a category rule by its unique identifier.
     *
     * @param id The unique identifier of the category rule to retrieve.
     * @return The matching category rule, or undefined if no rule is found.
     */
    getCategoryRuleById(id: number) {
        return db.prepare('SELECT * FROM category_rules WHERE id = ?').get(id) as CategoryRule | undefined;
    }

    /**
     * Creates a new category rule record in the database and returns the inserted rule.
     *
     * @param rule The rule data to insert, including pattern and category_id.
     * @return The newly created category rule record.
     */
    createCategoryRule(rule: NewCategoryRule) {
        return db.prepare('INSERT INTO category_rules (pattern, category_id) VALUES (?, ?) RETURNING *')
            .get(rule.pattern, rule.category_id) as CategoryRule;
    }

    /**
     * Updates an existing category rule record with the provided rule data.
     *
     * @param id The unique identifier of the category rule to update.
     * @param rule The new rule data to apply.
     * @return The updated category rule record, or undefined if no rule was updated.
     */
    updateCategoryRule(id: number, rule: NewCategoryRule) {
        return db.prepare('UPDATE category_rules SET pattern = ?, category_id = ? WHERE id = ? RETURNING *')
            .get(rule.pattern, rule.category_id, id) as CategoryRule | undefined;
    }

    /**
     * Deletes a category rule with the specified identifier from the database.
     *
     * @param id The unique identifier of the category rule to delete.
     * @return The result of the delete operation, including the number of affected rows.
     */
    deleteCategoryRule(id: number) {
        return db.prepare('DELETE FROM category_rules WHERE id = ?').run(id);
    }

    /**
     * Finds the category whose rule's pattern is the longest case-insensitive
     * substring match of the given description. Used as a fallback category
     * suggestion for import candidates with no categorized history match.
     *
     * @return The matching category_id, or null if no rule's pattern matches.
     */
    findCategoryForDescription(description: string): number | null {
        const row = db.prepare(
            `SELECT category_id FROM category_rules
             WHERE instr(lower(?), lower(pattern)) > 0
             ORDER BY length(pattern) DESC LIMIT 1`
        ).get(description) as {category_id: number} | undefined;
        return row?.category_id ?? null;
    }
}
