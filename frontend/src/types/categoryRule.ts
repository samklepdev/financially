export type CategoryRule = {
    id: number;
    pattern: string;
    category_id: number;
}

export type NewCategoryRule = Omit<CategoryRule, 'id'>;
