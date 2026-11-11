import type { Request, Response } from 'express';
import {validateCategoryRule} from "../helpers/categoryRuleValidation.ts";
import {CategoryRuleService} from "../services/categoryRules.service.ts";

const categoryRuleService = new CategoryRuleService();

/**
 * Retrieves all category rules from the database, ordered alphabetically by
 * pattern, and sends them in a JSON response.
 *
 * @param _req - The incoming request object. This parameter is not used.
 * @param res - The response object used to send the rule data.
 * @return The HTTP response containing the list of category rules.
 */
export function getAllCategoryRules(_req: Request, res: Response) {
    const rules = categoryRuleService.getAllCategoryRules();
    return res.status(200).json({data: rules});
}

/**
 * Retrieves a category rule by its numeric identifier from the request parameters and sends the result as a JSON response.
 *
 * @param req Express request containing the rule id route parameter.
 * @param res Express response used to send validation errors, not found errors, or the rule data.
 * @return The HTTP response containing either an error message or the requested rule data.
 */
export function getCategoryRuleById(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const rule = categoryRuleService.getCategoryRuleById(id);
    if (!rule) {
        return res.status(404).json({error: 'Category rule not found'});
    }

    return res.status(200).json({data: rule});
}

/**
 * Creates a new category rule from the request body after validating the submitted data.
 * Responds with a 400 status and validation error when the request body is invalid.
 * Responds with a 201 status and the created rule when insertion succeeds.
 * Responds with a 400 status when the referenced category does not exist.
 *
 * @param req Express request containing the rule data in the request body.
 * @param res Express response used to send the creation result or error response.
 * @return The Express response containing the created rule or an error response.
 */
export function createCategoryRule(req: Request, res: Response) {
    const result = validateCategoryRule(req.body);
    if (!result.ok) {
        return res.status(400).json({error: result.error});
    }

    try {
        const created = categoryRuleService.createCategoryRule(result.value);
        return res.status(201).json({data: created});
    } catch (err) {
        if (err instanceof Error && err.message.includes('FOREIGN KEY')) {
            return res.status(400).json({error: 'Category does not exist'});
        }
        throw err;
    }
}

/**
 * Updates an existing category rule by its request parameter id using the validated request body.
 *
 * @param req Express request containing the rule id in the route parameters and updated rule data in the body.
 * @param res Express response used to return the updated rule or an error response.
 * @return A JSON response with the updated rule, a validation error, a not found error, or a foreign key error.
 */
export function updateCategoryRule(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const result = validateCategoryRule(req.body);
    if (!result.ok) {
        return res.status(400).json({error: result.error});
    }

    try {
        const updated = categoryRuleService.updateCategoryRule(id, result.value);
        if (!updated) {
            return res.status(404).json({error: 'Category rule not found'});
        }
        return res.status(200).json({data: updated});
    } catch (err) {
        if (err instanceof Error && err.message.includes('FOREIGN KEY')) {
            return res.status(400).json({error: 'Category does not exist'});
        }
        throw err;
    }
}

/**
 * Deletes a category rule identified by the request route parameter.
 *
 * @param req Express request containing the rule id in the route parameters.
 * @param res Express response used to return the deletion result.
 * @return A response with status 204 when deleted, 400 when the id is invalid, or 404 when no rule is found.
 */
export function deleteCategoryRule(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const {changes} = categoryRuleService.deleteCategoryRule(id);
    if (changes === 0) {
        return res.status(404).json({error: 'Category rule not found'});
    }

    return res.status(204).end();
}
