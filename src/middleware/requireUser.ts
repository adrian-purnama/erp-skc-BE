import type { NextFunction, Request, Response } from "express";
import { als } from "../core/audit/context";
import type { HandlerMeta } from "../core/permissions/requirePermission";
import { ApiResponseDto } from "../dto/apiResponse.dto";
import { logger } from "../logger/logger";
import { AuthError, authenticateByToken } from "./authenticate";

type MetaHandler = {
  (req: Request, res: Response, next: NextFunction): unknown;
  meta?: HandlerMeta;
};

function readBearer(req: Request): string {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export const requireUser: MetaHandler = async (req, res, next) => {
  try {
    const user = await authenticateByToken(readBearer(req));
    req.user = user;
    // enterWith must run in this middleware frame (not inside authenticate's
    // post-await continuation) or ALS is empty for the rest of the request.
    als.enterWith({ userId: String(user._id) });
    next();
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        data: null,
      } satisfies ApiResponseDto);
    }

    logger.error(
      error instanceof Error ? error.message : String(error),
      "middleware/requireUser.ts",
      "requireUser",
    );

    return res.status(401).json({
      success: false,
      message: "Invalid token",
      data: null,
    } satisfies ApiResponseDto);
  }
};

requireUser.meta = { type: "auth" };
