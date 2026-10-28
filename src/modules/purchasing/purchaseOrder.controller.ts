import type { Request, Response } from "express";
import { fail, handle } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import {
  parseOptionalQueryId,
  parsePurchaseOrderStatusFilter,
  parseReasonDto,
  parseSavePurchaseOrderDto,
} from "../../validation/purchasing";
import { queryString } from "../../validation/query";
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

  /** Every PO waiting for approval. */
  approvals = async (req: Request, res: Response) => {
    return handle(res, "Failed to list PO", "PO retrieved", async () =>
      purchaseOrderService.list({ status: "pending_approval", q: queryString(req.query.q) }),
    );
  };

  get = async (req: Request, res: Response) => {
    return handle(res, "Failed to load PO", "PO retrieved", async () =>
      purchaseOrderService.get(parseRouteId(req.params.id), await actor(req)),
    );
  };

  create = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to create PO",
      "PO created",
      async () => purchaseOrderService.create(parseSavePurchaseOrderDto(req.body), await actor(req)),
      201,
    );
  };

  update = async (req: Request, res: Response) => {
    return handle(res, "Failed to save PO", "PO saved", async () =>
      purchaseOrderService.update(
        parseRouteId(req.params.id),
        parseSavePurchaseOrderDto(req.body),
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
