import {BaseApiService} from "./BaseApiService.ts";
import type {Category, NewCategory} from "../types/category.ts";

export class CategoryApiService extends BaseApiService {

    constructor() {
        super('/categories');
    }

    getAllCategories(): Promise<Category[]> {
        return this.getAll<Category[]>();
    }

    createCategory(body: NewCategory): Promise<Category> {
        return this.create<Category>(body);
    }

    updateCategory(id: number, body: NewCategory): Promise<Category> {
        return this.update<Category>(id, body);
    }

    deleteCategory(id: number): Promise<void> {
        return this.delete(id);
    }
}

export const categoryApiService = new CategoryApiService();
