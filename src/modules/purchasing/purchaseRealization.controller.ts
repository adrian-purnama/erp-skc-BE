import type { Request, Response } from "express";
import { getUserPermissions } from "../../core/permissions/resolve.service";
import { fail, handle } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import {
  parseOptionalQueryId,
  parseRealizationStatusFilter,
  parseReasonDto,
  parseSaveRealizationDto,
} from "../../validation/purchasing";
import { queryString } from "../../validation/query";
import type { PoActor } from "./purchaseOrder.service";
import { purchaseRealizationService } from "./purchaseRealization.service";

async function actor(req: Request): Promise<PoActor> {
  if (!req.user?._id) throw new Error("Unauthorized");
  const perms = await getUserPermissions(req.user);
  return { userId: String(req.user._id), superAdmin: perms.has("*") };
}

export class PurchaseRealizationController {
  buyers = async (_req: Request, res: Response) => {
    return handle(res, "Failed to load users", "Users retrieved", () =>
      purchaseRealizationService.buyers(),
    );
  };

  queue = async (_req: Request, res: Response) => {
    return handle(res, "Failed to load approved POs", "Approved POs retrieved", () =>
      purchaseRealizationService.queue(),
    );
  };

  plan = async (req: Request, res: Response) => {
    return handle(res, "Failed to load PO items", "PO items retrieved", () =>
      purchaseRealizationService.plan(
        parseRouteId(req.params.orderId),
        parseOptionalQueryId(queryString(req.query.exceptId), "exceptId"),
      ),
    );
  };

  list = async (req: Request, res: Response) => {
    return handle(res, "Failed to list notas", "Notas retrieved", async () =>
      purchaseRealizationService.list({
        status: parseRealizationStatusFilter(queryString(req.query.status)),
        purchaseOrderId: parseOptionalQueryId(queryString(req.query.purchaseOrderId), "purchaseOrderId"),
        q: queryString(req.query.q),
      }),
    );
  };

  get = async (req: Request, res: Response) => {
    return handle(res, "Failed to load nota", "Nota retrieved", async () =>
      purchaseRealizationService.get(parseRouteId(req.params.id), await actor(req)),
    );
  };

  create = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to save nota",
      "Nota saved",
      async () => purchaseRealizationService.create(parseSaveRealizationDto(req.body), await actor(req)),
      201,
    );
  };

  update = async (req: Request, res: Response) => {
    return handle(res, "Failed to save nota", "Nota saved", async () =>
      purchaseRealizationService.update(
        parseRouteId(req.params.id),
        parseSaveRealizationDto(req.body),
        await actor(req),
      ),
    );
  };

  remove = async (req: Request, res: Response) => {
    return handle(res, "Failed to delete nota", "Nota deleted", async () => {
      await purchaseRealizationService.remove(parseRouteId(req.params.id), await actor(req));
      return null;
    });
  };

  addPhotos = async (req: Request, res: Response) => {
    return handle(res, "Failed to upload files", "Files uploaded", async () =>
      purchaseRealizationService.addPhotos(
        parseRouteId(req.params.id),
        Array.isArray(req.files) ? req.files : [],
        await actor(req),
      ),
    );
  };

  removePhoto = async (req: Request, res: Response) => {
    return handle(res, "Failed to remove file", "File removed", async () =>
      purchaseRealizationService.removePhoto(
        parseRouteId(req.params.id),
        parseRouteId(req.params.photoId),
        await actor(req),
      ),
    );
  };

  photo = async (req: Request, res: Response) => {
    try {
      const { stream, filename, contentType } = await purchaseRealizationService.openPhoto(
        parseRouteId(req.params.id),
        parseRouteId(req.params.photoId),
      );
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `inline; filename="${filename.replace(/"/g, "")}"`);
      stream.on("error", () => {
        if (!res.headersSent) fail(res, null, "Failed to open file");
        else res.end();
      });
      stream.pipe(res);
    } catch (error) {
      fail(res, error, "Failed to open file");
    }
  };

  post = async (req: Request, res: Response) => {
    return handle(res, "Failed to post nota", "Nota posted", async () =>
      purchaseRealizationService.post(parseRouteId(req.params.id), await actor(req)),
    );
  };

  void = async (req: Request, res: Response) => {
    return handle(res, "Failed to void nota", "Nota voided", async () =>
      purchaseRealizationService.void(
        parseRouteId(req.params.id),
        parseReasonDto(req.body).reason,
        await actor(req),
      ),
    );
  };
}
