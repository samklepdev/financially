import {BaseApiService} from "./BaseApiService.ts";
import type {CategoryRule, NewCategoryRule} from "../types/categoryRule.ts";

export class CategoryRuleApiService extends BaseApiService {

    constructor() {
        super('/category-rules');
    }

    getAllCategoryRules(): Promise<CategoryRule[]> {
        return this.getAll<CategoryRule[]>();
    }

    createCategoryRule(body: NewCategoryRule): Promise<CategoryRule> {
        return this.create<CategoryRule>(body);
    }

    updateCategoryRule(id: number, body: NewCategoryRule): Promise<CategoryRule> {
        return this.update<CategoryRule>(id, body);
    }

    deleteCategoryRule(id: number): Promise<void> {
        return this.delete(id);
    }
}

export const categoryRuleApiService = new CategoryRuleApiService();
