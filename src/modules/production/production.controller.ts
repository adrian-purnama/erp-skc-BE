import type { Request, Response } from "express";
import type { ApiResponseDto } from "../../dto/apiResponse.dto";
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
  parseUpdateProductionOrderDto,
  parseVoidProductionReportDto,
} from "../../validation/production";
import { queryString } from "../../validation/query";
import {
  exportProductionOrderPdf,
  ProductionNotReadyError,
  productionService,
} from "./production.service";

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
}
