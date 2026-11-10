export type Category = {
    id: number;
    name: string;
    color: string;
}

export type NewCategory = Omit<Category, 'id'>;
