import type { Request, Response } from "express";
import { fail, ok } from "../../../dto/httpResponse";
import { permissionService } from "./permission.service";

function readQuery(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export class PermissionController {
  list = async (req: Request, res: Response) => {
    try {
      const data = await permissionService.list({
        q: readQuery(req.query.q),
        status: readQuery(req.query.status),
      });
      return ok(res, "Permissions retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to list permissions");
    }
  };

  scanReport = async (_req: Request, res: Response) => {
    try {
      const data = await permissionService.scanReportWithCounts();
      return ok(res, "Scan report retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to get scan report");
    }
  };
}
