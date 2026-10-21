import type { Request, Response } from "express";
import { fail, ok } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import {
  parseCreateCustomerDto,
  parseUpdateCustomerDto,
} from "../../validation/customer";
import { customerService } from "./customer.service";

export class CustomerController {
  list = async (req: Request, res: Response) => {
    try {
      const q =
        typeof req.query.q === "string" ? req.query.q : undefined;
      const data = await customerService.list(q);
      return ok(res, "Customers retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to list customers");
    }
  };

  listActive = async (req: Request, res: Response) => {
    try {
      const q =
        typeof req.query.q === "string" ? req.query.q : undefined;
      const data = await customerService.listActive(q);
      return ok(res, "Customers retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to list customers");
    }
  };

  get = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const data = await customerService.getById(id);
      if (!data) {
        return fail(res, null, "Customer not found");
      }
      return ok(res, "Customer retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to get customer");
    }
  };

  create = async (req: Request, res: Response) => {
    try {
      const input = parseCreateCustomerDto(req.body);
      const data = await customerService.create(input);
      return ok(res, "Customer created", data, 201);
    } catch (error) {
      return fail(res, error, "Failed to create customer");
    }
  };

  update = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const patch = parseUpdateCustomerDto(req.body);
      const data = await customerService.update(id, patch);
      return ok(res, "Customer updated", data);
    } catch (error) {
      return fail(res, error, "Failed to update customer");
    }
  };

  remove = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      await customerService.remove(id);
      return ok(res, "Customer deleted", null);
    } catch (error) {
      return fail(res, error, "Failed to delete customer");
    }
  };
}
