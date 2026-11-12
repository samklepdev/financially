import type { Request, Response } from 'express';
import {validateBill} from "../helpers/billValidation.ts";
import {BillService} from "../services/bill.service.ts";

const billService = new BillService();

/**
 * Retrieves all bills from the database, ordered alphabetically by name,
 * and sends them in a JSON response.
 *
 * @param _req - The incoming request object. This parameter is not used.
 * @param res - The response object used to send the bill data.
 * @return The HTTP response containing the list of bills.
 */
export function getAllBills(_req: Request, res: Response) {
    const bills = billService.getAllBills();
    return res.status(200).json({data: bills});
}

/**
 * Retrieves a bill by its numeric identifier from the request parameters and sends the result as a JSON response.
 *
 * @param req Express request containing the bill id route parameter.
 * @param res Express response used to send validation errors, not found errors, or the bill data.
 * @return The HTTP response containing either an error message or the requested bill data.
 */
export function getBillById(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const bill = billService.getBillById(id);
    if (!bill) {
        return res.status(404).json({error: 'Bill not found'});
    }

    return res.status(200).json({data: bill});
}

/**
 * Creates a new bill from the request body after validating the submitted data.
 *
 * @param req Express request containing the bill data in the request body.
 * @param res Express response used to send the creation result or error response.
 * @return The Express response containing the created bill or an error response.
 */
export function createBill(req: Request, res: Response) {
    const result = validateBill(req.body);
    if (!result.ok) {
        return res.status(400).json({error: result.error});
    }

    const created = billService.createBill(result.value);
    return res.status(201).json({data: created});
}

/**
 * Updates an existing bill by its request parameter id using the validated request body.
 *
 * @param req Express request containing the bill id in the route parameters and updated bill data in the body.
 * @param res Express response used to return the updated bill or an error response.
 * @return A JSON response with the updated bill, a validation error, or a not found error.
 */
export function updateBill(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const result = validateBill(req.body);
    if (!result.ok) {
        return res.status(400).json({error: result.error});
    }

    const updated = billService.updateBill(id, result.value);
    if (!updated) {
        return res.status(404).json({error: 'Bill not found'});
    }
    return res.status(200).json({data: updated});
}

/**
 * Deletes a bill identified by the request route parameter.
 *
 * @param req Express request containing the bill id in the route parameters.
 * @param res Express response used to return the deletion result.
 * @return A response with status 204 when deleted, 400 when the id is invalid, or 404 when no bill is found.
 */
export function deleteBill(req: Request<{id: string}>, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({error: 'id must be a whole number'});
    }

    const {changes} = billService.deleteBill(id);
    if (changes === 0) {
        return res.status(404).json({error: 'Bill not found'});
    }

    return res.status(204).end();
}

/**
 * Retrieves bills that are overdue or due within the next 14 days,
 * along with their payment status for the current cycle.
 *
 * @param _req - The incoming request object. This parameter is not used.
 * @param res - The response object used to send the upcoming-bills data.
 * @return The HTTP response containing the list of upcoming/overdue bills.
 */
export function getUpcomingBills(_req: Request, res: Response) {
    const upcoming = billService.getUpcomingBills();
    return res.status(200).json({data: upcoming});
}

/**
 * Retrieves candidate recurring bills detected from transaction history
 * that have not yet been set up as a bill.
 *
 * @param _req - The incoming request object. This parameter is not used.
 * @param res - The response object used to send the suggested-bills data.
 * @return The HTTP response containing the list of suggested bills.
 */
export function getSuggestedBills(_req: Request, res: Response) {
    const suggestions = billService.getSuggestedBills();
    return res.status(200).json({data: suggestions});
}
