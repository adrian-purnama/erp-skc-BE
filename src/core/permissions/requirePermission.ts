import type { NextFunction, Request, Response } from "express";
import { ApiResponseDto } from "../../dto/apiResponse.dto";
import { getUserPermissions } from "./resolve.service";

export type HandlerMeta =
  | { type: "permission"; key: string }
  | { type: "auth" }
  | { type: "public" };

type MetaHandler = {
  (req: Request, res: Response, next: NextFunction): unknown;
  meta?: HandlerMeta;
};

export function requirePermission(perm: { key: string }): MetaHandler {
  const handler: MetaHandler = async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        data: null,
      } satisfies ApiResponseDto);
    }

    const permissions = await getUserPermissions(req.user);
    if (permissions.has("*") || permissions.has(perm.key)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: "Forbidden",
      data: null,
    } satisfies ApiResponseDto);
  };

  handler.meta = { type: "permission", key: perm.key };
  return handler;
}

export function publicRoute(): MetaHandler {
  const handler: MetaHandler = (_req, _res, next) => next();
  handler.meta = { type: "public" };
  return handler;
}
