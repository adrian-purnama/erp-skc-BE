import type { Request, Response } from "express";
import { ApiResponseDto } from "../../../dto/httpResponse";
import { fail, handle, ok } from "../../../dto/httpResponse";
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
    return handle(res, "Failed to get Shrink DB status", "Shrink DB status", () =>
      shrinkDbService.status(),
    );
  };

  orphans = async (_req: Request, res: Response) => {
    return handle(res, "Failed to check orphans", "Orphan check complete", () =>
      shrinkDbService.checkOrphans(),
    );
  };

  purgeOrphans = async (req: Request, res: Response) => {
    return handle(res, "Failed to purge orphan blobs", "Orphan blobs purged", () =>
      shrinkDbService.purgeOrphanBlobs(
        parsePurgeOrphanBlobsDto(req.body).gridFsIds,
      ),
    );
  };
}
