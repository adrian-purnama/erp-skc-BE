import type { Request, Response } from "express";
import { fail, handle, ok } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import { queryString } from "../../validation/query";
import { parseCreateUomDto, parseUpdateUomDto } from "../../validation/uom";
import { uomService } from "./uom.service";

export class UomController {
  list = async (req: Request, res: Response) => {
    const category = queryString(req.query.category);
    return handle(res, "Failed to list UoMs", "UoMs retrieved", () =>
      uomService.list(category),
    );
  };

  get = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const data = await uomService.getById(id);
      if (!data) {
        return fail(res, null, "UoM not found");
      }
      return ok(res, "UoM retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to get UoM");
    }
  };

  create = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to create UoM",
      "UoM created",
      () => uomService.create(parseCreateUomDto(req.body)),
      201,
    );
  };

  update = async (req: Request, res: Response) => {
    return handle(res, "Failed to update UoM", "UoM updated", () =>
      uomService.update(
        parseRouteId(req.params.id),
        parseUpdateUomDto(req.body),
      ),
    );
  };

  remove = async (req: Request, res: Response) => {
    return handle(res, "Failed to delete UoM", "UoM deleted", async () => {
      await uomService.remove(parseRouteId(req.params.id));
      return null;
    });
  };
}
