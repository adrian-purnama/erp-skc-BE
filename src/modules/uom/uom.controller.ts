import type { Request, Response } from "express";
import { fail, ok } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import { parseCreateUomDto, parseUpdateUomDto } from "../../validation/uom";
import { uomService } from "./uom.service";

export class UomController {
  list = async (req: Request, res: Response) => {
    try {
      const category =
        typeof req.query.category === "string" ? req.query.category : undefined;
      const data = await uomService.list(category);
      return ok(res, "UoMs retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to list UoMs");
    }
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
    try {
      const input = parseCreateUomDto(req.body);
      const data = await uomService.create(input);
      return ok(res, "UoM created", data, 201);
    } catch (error) {
      return fail(res, error, "Failed to create UoM");
    }
  };

  update = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const input = parseUpdateUomDto(req.body);
      const data = await uomService.update(id, input);
      return ok(res, "UoM updated", data);
    } catch (error) {
      return fail(res, error, "Failed to update UoM");
    }
  };

  remove = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      await uomService.remove(id);
      return ok(res, "UoM deleted", null);
    } catch (error) {
      return fail(res, error, "Failed to delete UoM");
    }
  };
}
