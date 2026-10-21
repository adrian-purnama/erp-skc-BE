import type { Request, Response } from "express";
import { fail, ok } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import {
  parseCreateVendorDto,
  parseUpdateVendorDto,
} from "../../validation/vendor";
import { vendorService } from "./vendor.service";

export class VendorController {
  list = async (req: Request, res: Response) => {
    try {
      const q =
        typeof req.query.q === "string" ? req.query.q : undefined;
      const data = await vendorService.list(q);
      return ok(res, "Vendors retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to list vendors");
    }
  };

  listActive = async (req: Request, res: Response) => {
    try {
      const q =
        typeof req.query.q === "string" ? req.query.q : undefined;
      const data = await vendorService.listActive(q);
      return ok(res, "Vendors retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to list vendors");
    }
  };

  get = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const data = await vendorService.getById(id);
      if (!data) {
        return fail(res, null, "Vendor not found");
      }
      return ok(res, "Vendor retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to get vendor");
    }
  };

  create = async (req: Request, res: Response) => {
    try {
      const input = parseCreateVendorDto(req.body);
      const data = await vendorService.create(input);
      return ok(res, "Vendor created", data, 201);
    } catch (error) {
      return fail(res, error, "Failed to create vendor");
    }
  };

  update = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const patch = parseUpdateVendorDto(req.body);
      const data = await vendorService.update(id, patch);
      return ok(res, "Vendor updated", data);
    } catch (error) {
      return fail(res, error, "Failed to update vendor");
    }
  };

  remove = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      await vendorService.remove(id);
      return ok(res, "Vendor deleted", null);
    } catch (error) {
      return fail(res, error, "Failed to delete vendor");
    }
  };
}
