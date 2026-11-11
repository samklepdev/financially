import express from "express";
import {
    createCategoryRule, deleteCategoryRule, getAllCategoryRules, getCategoryRuleById, updateCategoryRule
} from "../controllers/categoryRules.controller.ts";

export const categoryRulesRouter = express.Router()

categoryRulesRouter.get('/', getAllCategoryRules);
categoryRulesRouter.post('/', createCategoryRule);
categoryRulesRouter.get('/:id', getCategoryRuleById);
categoryRulesRouter.put('/:id', updateCategoryRule);
categoryRulesRouter.delete('/:id', deleteCategoryRule);
