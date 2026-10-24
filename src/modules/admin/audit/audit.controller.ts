import type { Request, Response } from "express";
import { handle } from "../../../dto/httpResponse";
import { parseRouteId } from "../../../validation/parseParam";
import {
  parseAuditCollectionKey,
  parseAuditListQuery,
} from "../../../validation/audit";
import { auditService } from "./audit.service";

export class AuditController {
  listCollections = async (_req: Request, res: Response) => {
    return handle(
      res,
      "Failed to list audit collections",
      "Audit collections retrieved",
      () => Promise.resolve(auditService.listCollections()),
    );
  };

  list = async (req: Request, res: Response) => {
    return handle(res, "Failed to list audit events", "Audit events retrieved", () =>
      auditService.list(
        parseAuditCollectionKey(req.params.collection),
        parseAuditListQuery(req.query as Record<string, unknown>),
      ),
    );
  };

  get = async (req: Request, res: Response) => {
    return handle(res, "Failed to get audit event", "Audit event retrieved", () =>
      auditService.get(
        parseAuditCollectionKey(req.params.collection),
        parseRouteId(req.params.id),
      ),
    );
  };
}
