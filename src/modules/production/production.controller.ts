import type { Request, Response } from "express";
import type { ApiResponseDto } from "../../dto/httpResponse";
import type { ProductionReadinessOutDto } from "../../dto/production.dto";
import { getUserPermissions } from "../../core/permissions/resolve.service";
import { fail, handle, ok } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import {
  parseCancelProductionOrderDto,
  parseCompleteProductionOrderDto,
  parseCreateProductionOrderDto,
  parseCreateProductionReportDto,
  parseProductionOrderStatusFilter,
  parseSaveMaterialDispatchDto,
  parseSaveProductionHandoverDto,
  parseSendMaterialDispatchDto,
  parseUpdateProductionOrderDto,
  parseVoidProductionHandoverDto,
  parseVoidProductionReportDto,
} from "../../validation/production";
import { queryString } from "../../validation/query";
import {
  exportProductionOrderPdf,
  ProductionNotReadyError,
  productionService,
} from "./production.service";
import { exportHandoverPdf, productionHandoverService } from "./productionHandover.service";
import { exportDispatchPdf, materialDispatchService } from "./materialDispatch.service";

function userId(req: Request): string {
  if (!req.user?._id) throw new Error("Unauthorized");
  return String(req.user._id);
}

export class ProductionController {
  readiness = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to check production readiness",
      "Production readiness retrieved",
      () => productionService.readiness(parseRouteId(req.params.projectId)),
    );
  };

  release = async (req: Request, res: Response) => {
    try {
      const data = await productionService.release(
        parseRouteId(req.params.projectId),
        userId(req),
      );
      return ok(res, "Project released to production", data);
    } catch (error) {
      if (error instanceof ProductionNotReadyError) {
        // The client shows which items are still missing pieces.
        return res.status(409).json({
          success: false,
          message: error.message,
          data: error.readiness,
        } satisfies ApiResponseDto<ProductionReadinessOutDto>);
      }
      return fail(res, error, "Failed to release project to production");
    }
  };

  progress = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to load production progress",
      "Production progress retrieved",
      () => productionService.progress(parseRouteId(req.params.projectId)),
    );
  };

  listOrders = async (req: Request, res: Response) => {
    return handle(res, "Failed to list SPK", "SPK retrieved", async () => {
      const projectId = queryString(req.query.projectId);
      const perms = await getUserPermissions(req.user!);
      const viewAll = perms.has("*") || perms.has("production.viewAll");
      return productionService.listOrders({
        projectId,
        status: parseProductionOrderStatusFilter(queryString(req.query.status)),
        q: queryString(req.query.q),
        // The SPK Produksi list (no project) shows only your own SPKs unless you may see all.
        assignedTo: projectId || viewAll ? undefined : userId(req),
      });
    });
  };

  picUsers = async (_req: Request, res: Response) => {
    return handle(res, "Failed to list users", "Users retrieved", () =>
      productionService.listPicUsers(),
    );
  };

  orderPdf = async (req: Request, res: Response) => {
    try {
      const { buffer, filename, contentType } = await exportProductionOrderPdf(
        parseRouteId(req.params.id),
      );
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(buffer);
    } catch (error) {
      return fail(res, error, "Failed to export SPK");
    }
  };

  getOrder = async (req: Request, res: Response) => {
    return handle(res, "Failed to get SPK", "SPK retrieved", () =>
      productionService.getOrder(parseRouteId(req.params.id)),
    );
  };

  createOrder = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to create SPK",
      "SPK created",
      () =>
        productionService.createOrder(
          parseCreateProductionOrderDto(req.body),
          userId(req),
        ),
      201,
    );
  };

  updateOrder = async (req: Request, res: Response) => {
    return handle(res, "Failed to update SPK", "SPK updated", () =>
      productionService.updateOrder(
        parseRouteId(req.params.id),
        parseUpdateProductionOrderDto(req.body),
      ),
    );
  };

  deleteOrder = async (req: Request, res: Response) => {
    return handle(res, "Failed to delete SPK", "SPK deleted", async () => {
      await productionService.deleteOrder(parseRouteId(req.params.id));
      return null;
    });
  };

  releaseOrder = async (req: Request, res: Response) => {
    return handle(res, "Failed to release SPK", "SPK released", () =>
      productionService.releaseOrder(parseRouteId(req.params.id), userId(req)),
    );
  };

  revertOrder = async (req: Request, res: Response) => {
    return handle(res, "Failed to revert SPK", "SPK back to draft", () =>
      productionService.revertOrder(parseRouteId(req.params.id)),
    );
  };

  completeOrder = async (req: Request, res: Response) => {
    return handle(res, "Failed to complete SPK", "SPK completed", () =>
      productionService.completeOrder(
        parseRouteId(req.params.id),
        userId(req),
        parseCompleteProductionOrderDto(req.body).note,
      ),
    );
  };

  cancelOrder = async (req: Request, res: Response) => {
    return handle(res, "Failed to cancel SPK", "SPK cancelled", () =>
      productionService.cancelOrder(
        parseRouteId(req.params.id),
        userId(req),
        parseCancelProductionOrderDto(req.body).reason,
      ),
    );
  };

  addReport = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to add production report",
      "Production report added",
      () =>
        productionService.addReport(
          parseRouteId(req.params.id),
          parseCreateProductionReportDto(req.body),
          userId(req),
        ),
      201,
    );
  };

  voidReport = async (req: Request, res: Response) => {
    return handle(res, "Failed to void report", "Report voided", () =>
      productionService.voidReport(
        parseRouteId(req.params.id),
        userId(req),
        parseVoidProductionReportDto(req.body).reason,
      ),
    );
  };

  createHandover = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to add handover",
      "Handover saved as draft",
      () =>
        productionHandoverService.create(
          parseRouteId(req.params.id),
          parseSaveProductionHandoverDto(req.body),
          userId(req),
        ),
      201,
    );
  };

  updateHandover = async (req: Request, res: Response) => {
    return handle(res, "Failed to save handover", "Handover saved", () =>
      productionHandoverService.update(
        parseRouteId(req.params.id),
        parseSaveProductionHandoverDto(req.body),
      ),
    );
  };

  deleteHandover = async (req: Request, res: Response) => {
    return handle(res, "Failed to delete handover", "Handover deleted", () =>
      productionHandoverService.remove(parseRouteId(req.params.id)),
    );
  };

  postHandover = async (req: Request, res: Response) => {
    return handle(res, "Failed to post handover", "Handover posted", () =>
      productionHandoverService.post(parseRouteId(req.params.id), userId(req)),
    );
  };

  voidHandover = async (req: Request, res: Response) => {
    return handle(res, "Failed to void handover", "Handover voided", () =>
      productionHandoverService.void(
        parseRouteId(req.params.id),
        userId(req),
        parseVoidProductionHandoverDto(req.body).reason,
      ),
    );
  };

  addHandoverPhotos = async (req: Request, res: Response) => {
    return handle(res, "Failed to upload files", "Files uploaded", () =>
      productionHandoverService.addPhotos(
        parseRouteId(req.params.id),
        Array.isArray(req.files) ? req.files : [],
        userId(req),
      ),
    );
  };

  removeHandoverPhoto = async (req: Request, res: Response) => {
    return handle(res, "Failed to remove file", "File removed", () =>
      productionHandoverService.removePhoto(
        parseRouteId(req.params.id),
        parseRouteId(req.params.photoId),
      ),
    );
  };

  handoverPhoto = async (req: Request, res: Response) => {
    try {
      const { stream, filename, contentType } = await productionHandoverService.openPhoto(
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

  handoverPdf = async (req: Request, res: Response) => {
    try {
      const { buffer, filename, contentType } = await exportHandoverPdf(
        parseRouteId(req.params.id),
      );
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(buffer);
    } catch (error) {
      return fail(res, error, "Failed to export handover");
    }
  };

  createDispatch = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to add surat jalan",
      "Surat jalan saved as draft",
      () =>
        materialDispatchService.create(
          parseRouteId(req.params.id),
          parseSaveMaterialDispatchDto(req.body),
          userId(req),
        ),
      201,
    );
  };

  updateDispatch = async (req: Request, res: Response) => {
    return handle(res, "Failed to save surat jalan", "Surat jalan saved", () =>
      materialDispatchService.update(parseRouteId(req.params.id), parseSaveMaterialDispatchDto(req.body)),
    );
  };

  deleteDispatch = async (req: Request, res: Response) => {
    return handle(res, "Failed to delete surat jalan", "Surat jalan deleted", () =>
      materialDispatchService.remove(parseRouteId(req.params.id)),
    );
  };

  submitDispatch = async (req: Request, res: Response) => {
    return handle(res, "Failed to send for approval", "Sent for approval", () =>
      materialDispatchService.submit(parseRouteId(req.params.id)),
    );
  };

  approveDispatch = async (req: Request, res: Response) => {
    return handle(res, "Failed to approve surat jalan", "Surat jalan approved", () =>
      materialDispatchService.approve(parseRouteId(req.params.id), userId(req)),
    );
  };

  rejectDispatch = async (req: Request, res: Response) => {
    return handle(res, "Failed to reject surat jalan", "Surat jalan rejected", () =>
      materialDispatchService.reject(parseRouteId(req.params.id), userId(req), parseVoidProductionHandoverDto(req.body).reason),
    );
  };

  sendDispatch = async (req: Request, res: Response) => {
    return handle(res, "Failed to mark sent", "Material marked as sent", () =>
      materialDispatchService.send(parseRouteId(req.params.id), userId(req), parseSendMaterialDispatchDto(req.body)),
    );
  };

  cancelDispatch = async (req: Request, res: Response) => {
    return handle(res, "Failed to cancel surat jalan", "Surat jalan cancelled", () =>
      materialDispatchService.cancel(parseRouteId(req.params.id), userId(req), parseVoidProductionHandoverDto(req.body).reason),
    );
  };

  voidDispatch = async (req: Request, res: Response) => {
    return handle(res, "Failed to void surat jalan", "Surat jalan voided", () =>
      materialDispatchService.void(parseRouteId(req.params.id), userId(req), parseVoidProductionHandoverDto(req.body).reason),
    );
  };

  addDispatchPhotos = async (req: Request, res: Response) => {
    return handle(res, "Failed to upload files", "Files uploaded", () =>
      materialDispatchService.addPhotos(parseRouteId(req.params.id), Array.isArray(req.files) ? req.files : [], userId(req)),
    );
  };

  removeDispatchPhoto = async (req: Request, res: Response) => {
    return handle(res, "Failed to remove file", "File removed", () =>
      materialDispatchService.removePhoto(parseRouteId(req.params.id), parseRouteId(req.params.photoId)),
    );
  };

  dispatchPhoto = async (req: Request, res: Response) => {
    try {
      const { stream, filename, contentType } = await materialDispatchService.openPhoto(
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

  dispatchPdf = async (req: Request, res: Response) => {
    try {
      const { buffer, filename, contentType } = await exportDispatchPdf(parseRouteId(req.params.id));
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(buffer);
    } catch (error) {
      return fail(res, error, "Failed to export surat jalan");
    }
  };
}
