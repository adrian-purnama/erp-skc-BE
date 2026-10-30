import type { Request, Response } from "express";
import { fail, handle } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import {
  parseApprovalLevel,
  parseOptionalQueryId,
  parseChargeList,
  parsePurchaseOrderStatusFilter,
  parseReasonDto,
  parseSavePurchaseOrdersDto,
} from "../../validation/purchasing";
import { queryString } from "../../validation/query";
import { parseRenameProjectFileDto } from "../../validation/projectDocument";
import { asRecord } from "../../validation/asRecord";
import { getUserPermissions } from "../../core/permissions/resolve.service";
import {
  exportPurchaseOrderPdf,
  purchaseOrderService,
  type PoActor,
} from "./purchaseOrder.service";

async function actor(req: Request): Promise<PoActor> {
  if (!req.user?._id) throw new Error("Unauthorized");
  const perms = await getUserPermissions(req.user);
  return { userId: String(req.user._id), superAdmin: perms.has("*") };
}

export class PurchaseOrderController {
  vendors = async (_req: Request, res: Response) => {
    return handle(res, "Failed to load vendors", "Vendors retrieved", () =>
      purchaseOrderService.vendorOptions(),
    );
  };

  terms = async (_req: Request, res: Response) => {
    return handle(res, "Failed to load terms of payment", "Terms retrieved", () =>
      purchaseOrderService.termOptions(),
    );
  };

  openLines = async (req: Request, res: Response) => {
    return handle(res, "Failed to load open request lines", "Open request lines retrieved", () =>
      purchaseOrderService.openLines(
        parseRouteId(queryString(req.query.requestId)),
        parseOptionalQueryId(queryString(req.query.exceptOrderId), "exceptOrderId"),
      ),
    );
  };

  /** POs the signed-in user created. */
  mine = async (req: Request, res: Response) => {
    return handle(res, "Failed to list PO", "PO retrieved", async () =>
      purchaseOrderService.list({
        createdBy: (await actor(req)).userId,
        status: parsePurchaseOrderStatusFilter(queryString(req.query.status)),
        requestId: parseOptionalQueryId(queryString(req.query.requestId), "requestId"),
        q: queryString(req.query.q),
      }),
    );
  };

  /** POs waiting on the signed-in user's approval (level 1 or 2). */
  approvals = async (req: Request, res: Response) => {
    return handle(res, "Failed to list PO", "PO retrieved", async () =>
      purchaseOrderService.list({
        waitingOn: (await actor(req)).userId,
        q: queryString(req.query.q),
      }),
    );
  };

  approvers = async (req: Request, res: Response) => {
    return handle(res, "Failed to load approvers", "Approvers retrieved", () =>
      purchaseOrderService.approverOptions(parseApprovalLevel(queryString(req.query.level))),
    );
  };

  setEstimates = async (req: Request, res: Response) => {
    return handle(res, "Failed to save estimates", "Estimates saved", async () =>
      purchaseOrderService.setEstimates(
        parseRouteId(req.params.id),
        parseChargeList(asRecord(req.body).charges),
        await actor(req),
      ),
    );
  };

  /** `?force=true` stores a separate copy even when the content already exists. */
  uploadQuotation = async (req: Request, res: Response) => {
    return handle(res, "Failed to upload quotation", "Quotation uploaded", async () =>
      purchaseOrderService.uploadQuotation(
        parseRouteId(req.params.id),
        req.file,
        queryString(req.query.force) === "true",
        await actor(req),
      ),
    );
  };

  setCurrentQuotation = async (req: Request, res: Response) => {
    return handle(res, "Failed to use this version", "Quotation version in use", async () =>
      purchaseOrderService.setCurrentQuotation(
        parseRouteId(req.params.id),
        parseRouteId(req.params.fileId),
        await actor(req),
      ),
    );
  };

  renameQuotation = async (req: Request, res: Response) => {
    return handle(res, "Failed to rename quotation", "Quotation renamed", async () =>
      purchaseOrderService.renameQuotation(
        parseRouteId(req.params.id),
        parseRouteId(req.params.fileId),
        parseRenameProjectFileDto(req.body).originalFilename,
        await actor(req),
      ),
    );
  };

  removeQuotation = async (req: Request, res: Response) => {
    return handle(res, "Failed to remove quotation", "Quotation removed", async () =>
      purchaseOrderService.removeQuotation(
        parseRouteId(req.params.id),
        parseRouteId(req.params.fileId),
        await actor(req),
      ),
    );
  };

  quotation = async (req: Request, res: Response) => {
    try {
      const { stream, filename, contentType } = await purchaseOrderService.openQuotation(
        parseRouteId(req.params.id),
        parseRouteId(req.params.fileId),
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

  get = async (req: Request, res: Response) => {
    return handle(res, "Failed to load PO", "PO retrieved", async () =>
      purchaseOrderService.get(parseRouteId(req.params.id), await actor(req)),
    );
  };

  rabCompare = async (req: Request, res: Response) => {
    return handle(res, "Failed to compare PO with RAB", "RAB comparison retrieved", () =>
      purchaseOrderService.rabCompare(parseRouteId(req.params.id)),
    );
  };

  create = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to create PO",
      "PO created",
      async () => purchaseOrderService.save(null, parseSavePurchaseOrdersDto(req.body), await actor(req)),
      201,
    );
  };

  update = async (req: Request, res: Response) => {
    return handle(res, "Failed to save PO", "PO saved", async () =>
      purchaseOrderService.save(
        parseRouteId(req.params.id),
        parseSavePurchaseOrdersDto(req.body),
        await actor(req),
      ),
    );
  };

  remove = async (req: Request, res: Response) => {
    return handle(res, "Failed to delete PO", "PO deleted", async () => {
      await purchaseOrderService.remove(parseRouteId(req.params.id), await actor(req));
      return null;
    });
  };

  submit = async (req: Request, res: Response) => {
    return handle(res, "Failed to send PO for approval", "PO sent for approval", async () =>
      purchaseOrderService.submit(parseRouteId(req.params.id), await actor(req)),
    );
  };

  approve = async (req: Request, res: Response) => {
    return handle(res, "Failed to approve PO", "PO approved", async () =>
      purchaseOrderService.approve(parseRouteId(req.params.id), await actor(req)),
    );
  };

  reject = async (req: Request, res: Response) => {
    return handle(res, "Failed to reject PO", "PO rejected", async () =>
      purchaseOrderService.reject(
        parseRouteId(req.params.id),
        await actor(req),
        parseReasonDto(req.body).reason,
      ),
    );
  };

  revise = async (req: Request, res: Response) => {
    return handle(res, "Failed to revise PO", "PO back to draft", async () =>
      purchaseOrderService.revise(parseRouteId(req.params.id), await actor(req)),
    );
  };

  cancel = async (req: Request, res: Response) => {
    return handle(res, "Failed to cancel PO", "PO cancelled", async () =>
      purchaseOrderService.cancel(
        parseRouteId(req.params.id),
        await actor(req),
        parseReasonDto(req.body).reason,
      ),
    );
  };

  pdf = async (req: Request, res: Response) => {
    try {
      const file = await exportPurchaseOrderPdf(parseRouteId(req.params.id));
      res.setHeader("Content-Type", file.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
      return res.send(file.buffer);
    } catch (error) {
      return fail(res, error, "Failed to export PO");
    }
  };
}
