import type { Request, Response } from "express";
import { purchaseFlow } from "./purchaseFlow.service";
import { getUserPermissions } from "../../core/permissions/resolve.service";
import { handle } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import {
  parseCancelPurchaseRequestDto,
  parseCreatePurchaseRequestDto,
  parseOptionalQueryId,
  parsePurchaseRequestStatusFilter,
  parseUpdatePurchaseRequestDto,
} from "../../validation/purchasing";
import { queryString } from "../../validation/query";
import { purchasingService, type PurchasingViewer } from "./purchasing.service";

async function viewer(req: Request): Promise<PurchasingViewer> {
  if (!req.user?._id) throw new Error("Unauthorized");
  const perms = await getUserPermissions(req.user);
  const manage = perms.has("*") || perms.has("purchasing.manage");
  return {
    userId: String(req.user._id),
    viewAll: manage || perms.has("purchasing.viewAll"),
    manage,
  };
}

export class PurchasingController {
  materials = async (_req: Request, res: Response) => {
    return handle(res, "Failed to load materials", "Materials retrieved", () =>
      purchasingService.listMaterials(),
    );
  };

  mySpks = async (req: Request, res: Response) => {
    return handle(res, "Failed to load SPKs", "SPKs retrieved", async () =>
      purchasingService.listMySpks((await viewer(req)).userId),
    );
  };

  projectContext = async (req: Request, res: Response) => {
    return handle(res, "Failed to load project", "Project retrieved", () =>
      purchasingService.projectContext(parseRouteId(req.params.projectId)),
    );
  };

  rabPlan = async (req: Request, res: Response) => {
    return handle(res, "Failed to load RAB items", "RAB items retrieved", () =>
      purchasingService.rabPlan(
        parseRouteId(req.params.purchaseRabId),
        parseOptionalQueryId(queryString(req.query.exceptRequestId), "exceptRequestId"),
      ),
    );
  };

  plan = async (req: Request, res: Response) => {
    return handle(res, "Failed to load SPK materials", "SPK materials retrieved", () =>
      purchasingService.plan(
        parseRouteId(req.params.productionOrderId),
        parseOptionalQueryId(queryString(req.query.exceptRequestId), "exceptRequestId"),
      ),
    );
  };

  list = async (req: Request, res: Response) => {
    return handle(res, "Failed to list SPP", "SPP retrieved", async () =>
      purchasingService.list(
        {
          projectId: parseOptionalQueryId(queryString(req.query.projectId), "projectId"),
          productionOrderId: parseOptionalQueryId(
            queryString(req.query.productionOrderId),
            "productionOrderId",
          ),
          purchaseRabId: parseOptionalQueryId(queryString(req.query.purchaseRabId), "purchaseRabId"),
          status: parsePurchaseRequestStatusFilter(queryString(req.query.status)),
          q: queryString(req.query.q),
        },
        await viewer(req),
      ),
    );
  };

  get = async (req: Request, res: Response) => {
    return handle(res, "Failed to load SPP", "SPP retrieved", async () =>
      purchasingService.get(parseRouteId(req.params.id), await viewer(req)),
    );
  };

  create = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to create SPP",
      "SPP created",
      async () => purchasingService.create(parseCreatePurchaseRequestDto(req.body), await viewer(req)),
      201,
    );
  };

  update = async (req: Request, res: Response) => {
    return handle(res, "Failed to save SPP", "SPP saved", async () =>
      purchasingService.update(
        parseRouteId(req.params.id),
        parseUpdatePurchaseRequestDto(req.body),
        await viewer(req),
      ),
    );
  };

  remove = async (req: Request, res: Response) => {
    return handle(res, "Failed to delete SPP", "SPP deleted", async () => {
      await purchasingService.remove(parseRouteId(req.params.id), await viewer(req));
      return null;
    });
  };

  submit = async (req: Request, res: Response) => {
    return handle(res, "Failed to submit SPP", "SPP submitted", async () =>
      purchasingService.submit(parseRouteId(req.params.id), await viewer(req)),
    );
  };

  decline = async (req: Request, res: Response) => {
    return handle(res, "Failed to decline SPP", "SPP declined", async () =>
      purchasingService.decline(
        parseRouteId(req.params.id),
        parseCancelPurchaseRequestDto(req.body).reason,
        await viewer(req),
      ),
    );
  };

  confirmReceived = async (req: Request, res: Response) => {
    return handle(res, "Failed to confirm SPP", "SPP confirmed as received", async () =>
      purchasingService.confirmReceived(parseRouteId(req.params.id), await viewer(req)),
    );
  };

  cancel = async (req: Request, res: Response) => {
    return handle(res, "Failed to cancel SPP", "SPP cancelled", async () =>
      purchasingService.cancel(
        parseRouteId(req.params.id),
        parseCancelPurchaseRequestDto(req.body).reason,
        await viewer(req),
      ),
    );
  };

  /** SPP → PO → receipts → payments around one document (related documents only). */
  flow = async (req: Request, res: Response) => {
    return handle(res, "Failed to load the purchase flow", "Purchase flow retrieved", () => {
      const kind = queryString(req.query.kind);
      if (kind !== "request" && kind !== "order" && kind !== "realization" && kind !== "payment" && kind !== "spk") {
        throw new Error("kind must be request, order, realization, payment or spk");
      }
      return purchaseFlow(kind, parseRouteId(queryString(req.query.id)));
    });
  };
}
