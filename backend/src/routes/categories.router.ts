import express from "express";
import {
    createCategory, deleteCategory, getAllCategories, getCategoryById, updateCategory
} from "../controllers/categories.controller.ts";

export const categoriesRouter = express.Router()

categoriesRouter.get('/', getAllCategories);
categoriesRouter.post('/', createCategory);
categoriesRouter.get('/:id', getCategoryById);
categoriesRouter.put('/:id', updateCategory);
categoriesRouter.delete('/:id', deleteCategory);
