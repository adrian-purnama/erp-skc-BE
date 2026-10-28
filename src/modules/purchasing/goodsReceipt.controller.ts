import type { Request, Response } from "express";
import { getUserPermissions } from "../../core/permissions/resolve.service";
import { handle } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import {
  parseCreateGoodsReceiptDto,
  parseGoodsReceiptStatusFilter,
  parseOptionalQueryId,
  parseReasonDto,
} from "../../validation/purchasing";
import { queryString } from "../../validation/query";
import { goodsReceiptService } from "./goodsReceipt.service";
import type { PoActor } from "./purchaseOrder.service";
import { purchaseRealizationService } from "./purchaseRealization.service";

async function actor(req: Request): Promise<PoActor> {
  if (!req.user?._id) throw new Error("Unauthorized");
  const perms = await getUserPermissions(req.user);
  return { userId: String(req.user._id), superAdmin: perms.has("*") };
}

export class GoodsReceiptController {
  receivers = async (_req: Request, res: Response) => {
    return handle(res, "Failed to load users", "Users retrieved", () =>
      purchaseRealizationService.buyers(),
    );
  };

  queue = async (_req: Request, res: Response) => {
    return handle(res, "Failed to load approved POs", "Approved POs retrieved", () =>
      goodsReceiptService.queue(),
    );
  };

  plan = async (req: Request, res: Response) => {
    return handle(res, "Failed to load PO items", "PO items retrieved", () =>
      goodsReceiptService.plan(parseRouteId(req.params.orderId)),
    );
  };

  list = async (req: Request, res: Response) => {
    return handle(res, "Failed to list receipts", "Receipts retrieved", async () =>
      goodsReceiptService.list({
        status: parseGoodsReceiptStatusFilter(queryString(req.query.status)),
        purchaseOrderId: parseOptionalQueryId(queryString(req.query.purchaseOrderId), "purchaseOrderId"),
        q: queryString(req.query.q),
      }),
    );
  };

  get = async (req: Request, res: Response) => {
    return handle(res, "Failed to load receipt", "Receipt retrieved", () =>
      goodsReceiptService.get(parseRouteId(req.params.id)),
    );
  };

  create = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to save receipt",
      "Goods received",
      async () => goodsReceiptService.create(parseCreateGoodsReceiptDto(req.body), await actor(req)),
      201,
    );
  };

  void = async (req: Request, res: Response) => {
    return handle(res, "Failed to void receipt", "Receipt voided", async () =>
      goodsReceiptService.void(
        parseRouteId(req.params.id),
        parseReasonDto(req.body).reason,
        await actor(req),
      ),
    );
  };
}
