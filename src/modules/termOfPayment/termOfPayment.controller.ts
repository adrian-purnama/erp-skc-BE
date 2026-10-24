import type { Request, Response } from "express";
import { fail, handle, ok } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import {
  parseCreateTermOfPaymentDto,
  parseUpdateTermOfPaymentDto,
} from "../../validation/termOfPayment";
import { termOfPaymentService } from "./termOfPayment.service";

export class TermOfPaymentController {
  list = async (_req: Request, res: Response) => {
    return handle(
      res,
      "Failed to list terms of payment",
      "Terms of payment retrieved",
      () => termOfPaymentService.list(),
    );
  };

  get = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const data = await termOfPaymentService.getById(id);
      if (!data) {
        return fail(res, null, "Term of payment not found");
      }
      return ok(res, "Term of payment retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to get term of payment");
    }
  };

  create = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to create term of payment",
      "Term of payment created",
      () => termOfPaymentService.create(parseCreateTermOfPaymentDto(req.body)),
      201,
    );
  };

  update = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to update term of payment",
      "Term of payment updated",
      () =>
        termOfPaymentService.update(
          parseRouteId(req.params.id),
          parseUpdateTermOfPaymentDto(req.body),
        ),
    );
  };

  remove = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to delete term of payment",
      "Term of payment deleted",
      async () => {
        await termOfPaymentService.remove(parseRouteId(req.params.id));
        return null;
      },
    );
  };
}
