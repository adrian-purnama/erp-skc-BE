import type { Request, Response } from "express";
import { fail, ok } from "../../../dto/httpResponse";
import { parseRouteId } from "../../../validation/parseParam";
import {
  parseAuditCollectionKey,
  parseAuditListQuery,
} from "../../../validation/audit";
import { auditService } from "./audit.service";

export class AuditController {
  listCollections = async (_req: Request, res: Response) => {
    try {
      const data = auditService.listCollections();
      return ok(res, "Audit collections retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to list audit collections");
    }
  };

  list = async (req: Request, res: Response) => {
    try {
      const collection = parseAuditCollectionKey(req.params.collection);
      const query = parseAuditListQuery(req.query as Record<string, unknown>);
      const data = await auditService.list(collection, query);
      return ok(res, "Audit events retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to list audit events");
    }
  };

  get = async (req: Request, res: Response) => {
    try {
      const collection = parseAuditCollectionKey(req.params.collection);
      const id = parseRouteId(req.params.id);
      const data = await auditService.get(collection, id);
      return ok(res, "Audit event retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to get audit event");
    }
  };
}
