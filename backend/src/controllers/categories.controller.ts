import type { Request, Response } from 'express';
import {validateCategory} from "../helpers/categoryValidation.ts";
import {CategoryService} from "../services/categories.service.ts";

const categoryService = new CategoryService();

/**
 * Retrieves all categories from the database, ordered alphabetically by name,
 * and sends them in a JSON response.
 *
 * @param _req - The incoming request object. This parameter is not used.
 * @param res - The response object used to send the category data.
 * @return The HTTP response containing the list of categories.
 */
export function getAllCategories(_req: Request, res: Response) {
    const categories = categoryService.getAllCategories();
    return res.status(200).json({data: categories});
}

/**
 * Retrieves a category by its numeric identifier from the request parameters and sends the result as a JSON response.
 *
 * @param req Express request containing the category id route parameter.
 * @param res Express response used to send validation errors, not found errors, or the category data.
 * @return The HTTP response containing either an error message or the requested category data.
 */
export function getCategoryById(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const category = categoryService.getCategoryById(id);
    if (!category) {
        return res.status(404).json({error: 'Category not found'});
    }

    return res.status(200).json({data: category});
}

/**
 * Creates a new category from the request body after validating the submitted data.
 * Responds with a 400 status and validation error when the request body is invalid.
 * Responds with a 201 status and the created category when insertion succeeds.
 * Responds with a 400 status when the category name already exists.
 *
 * @param req Express request containing the category data in the request body.
 * @param res Express response used to send the creation result or error response.
 * @return The Express response containing the created category or an error response.
 */
export function createCategory(req: Request, res: Response) {
    const result = validateCategory(req.body);
    if (!result.ok) {
        return res.status(400).json({error: result.error});
    }

    try {
        const created = categoryService.createCategory(result.value);
        return res.status(201).json({data: created});
    } catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
            return res.status(400).json({error: 'Category name already exists'});
        }
        throw err;
    }
}

/**
 * Updates an existing category by its request parameter id using the validated request body.
 *
 * @param req Express request containing the category id in the route parameters and updated category data in the body.
 * @param res Express response used to return the updated category or an error response.
 * @return A JSON response with the updated category, a validation error, a not found error, or a duplicate-name error.
 */
export function updateCategory(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const result = validateCategory(req.body);
    if (!result.ok) {
        return res.status(400).json({error: result.error});
    }

    try {
        const updated = categoryService.updateCategory(id, result.value);
        if (!updated) {
            return res.status(404).json({error: 'Category not found'});
        }
        return res.status(200).json({data: updated});
    } catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
            return res.status(400).json({error: 'Category name already exists'});
        }
        throw err;
    }
}

/**
 * Deletes a category identified by the request route parameter.
 *
 * @param req Express request containing the category id in the route parameters.
 * @param res Express response used to return the deletion result.
 * @return A response with status 204 when deleted, 400 when the id is invalid, or 404 when no category is found.
 */
export function deleteCategory(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const {changes} = categoryService.deleteCategory(id);
    if (changes === 0) {
        return res.status(404).json({error: 'Category not found'});
    }

    return res.status(204).end();
}
