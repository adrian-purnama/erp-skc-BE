import type { Request, Response } from "express";
import { ApiResponseDto } from "../../../dto/apiResponse.dto";
import { fail, ok } from "../../../dto/httpResponse";
import {
  parsePurgeOrphanBlobsDto,
  parseStartShrinkDbDto,
} from "../../../validation/shrinkDb";
import { ShrinkDbConflictError, shrinkDbService } from "./shrinkDb.service";

export class ShrinkDbController {
  start = async (req: Request, res: Response) => {
    try {
      const { section, excludedProjectIds } = parseStartShrinkDbDto(req.body);
      const userId = req.user ? String(req.user._id) : "";
      if (!userId) throw new Error("Authentication required");
      const data = await shrinkDbService.start(
        section,
        excludedProjectIds,
        userId,
      );
      return ok(res, "Shrink DB job started", data, 201);
    } catch (error) {
      if (error instanceof ShrinkDbConflictError) {
        return res.status(409).json({
          success: false,
          message: error.message,
          data: null,
        } satisfies ApiResponseDto);
      }
      return fail(res, error, "Failed to start Shrink DB");
    }
  };

  status = async (_req: Request, res: Response) => {
    try {
      const data = await shrinkDbService.status();
      return ok(res, "Shrink DB status", data);
    } catch (error) {
      return fail(res, error, "Failed to get Shrink DB status");
    }
  };

  orphans = async (_req: Request, res: Response) => {
    try {
      const data = await shrinkDbService.checkOrphans();
      return ok(res, "Orphan check complete", data);
    } catch (error) {
      return fail(res, error, "Failed to check orphans");
    }
  };

  purgeOrphans = async (req: Request, res: Response) => {
    try {
      const { gridFsIds } = parsePurgeOrphanBlobsDto(req.body);
      const data = await shrinkDbService.purgeOrphanBlobs(gridFsIds);
      return ok(res, "Orphan blobs purged", data);
    } catch (error) {
      return fail(res, error, "Failed to purge orphan blobs");
    }
  };
}
