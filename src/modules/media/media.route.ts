import type { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";
import { fail } from "../../dto/httpResponse";
import { findFile, openDownload } from "../../buckets/gridfs";
import { createRouter } from "../../core/permissions/routing";
import { publicRoute } from "../../core/permissions/requirePermission";

const router = createRouter();

router.get(
  "/:id",
  publicRoute(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      if (!id || !Types.ObjectId.isValid(id)) {
        return fail(res, null, "Invalid file id");
      }

      const file = await findFile("public", id);
      if (!file) {
        return fail(res, null, "File not found", 404);
      }

      const contentType =
        (typeof file.metadata?.contentType === "string"
          ? file.metadata.contentType
          : undefined) ?? "application/octet-stream";

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

      openDownload("public", id).on("error", next).pipe(res);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
