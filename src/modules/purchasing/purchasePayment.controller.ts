import type { Request, Response } from "express";
import { getUserPermissions } from "../../core/permissions/resolve.service";
import { fail, handle } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import {
  parsePaymentKindFilter,
  parsePaymentStatusFilter,
  parsePayPurchasePaymentDto,
  parseReasonDto,
  parseSaveReimbursementDto,
  parseSaveVendorPaymentDto,
} from "../../validation/purchasing";
import { queryString } from "../../validation/query";
import type { PoActor } from "./purchaseOrder.service";
import { purchasePaymentService } from "./purchasePayment.service";

async function actor(req: Request): Promise<PoActor> {
  if (!req.user?._id) throw new Error("Unauthorized");
  const perms = await getUserPermissions(req.user);
  return { userId: String(req.user._id), superAdmin: perms.has("*") };
}

export class PurchasePaymentController {
  list = async (req: Request, res: Response) => {
    return handle(res, "Failed to list payments", "Payments retrieved", async () =>
      purchasePaymentService.list(
        {
          kind: parsePaymentKindFilter(queryString(req.query.kind)),
          status: parsePaymentStatusFilter(queryString(req.query.status)),
          q: queryString(req.query.q),
        },
        await actor(req),
      ),
    );
  };

  approvals = async (req: Request, res: Response) => {
    return handle(res, "Failed to load payment approvals", "Payment approvals retrieved", async () =>
      purchasePaymentService.approvals(await actor(req)),
    );
  };

  forOrder = async (req: Request, res: Response) => {
    return handle(res, "Failed to load PO payments", "PO payments retrieved", async () =>
      purchasePaymentService.forOrder(parseRouteId(req.params.id), await actor(req)),
    );
  };

  listPayable = async (req: Request, res: Response) => {
    return handle(res, "Failed to list payable POs", "Payable POs retrieved", () =>
      purchasePaymentService.listPayable(queryString(req.query.q)),
    );
  };

  reimbursable = async (req: Request, res: Response) => {
    return handle(res, "Failed to load notas", "Notas retrieved", () =>
      purchasePaymentService.reimbursable(
        parseRouteId(queryString(req.query.payeeUserId)),
        queryString(req.query.exceptId),
      ),
    );
  };

  get = async (req: Request, res: Response) => {
    return handle(res, "Failed to get payment", "Payment retrieved", async () =>
      purchasePaymentService.get(parseRouteId(req.params.id), await actor(req)),
    );
  };

  createVendor = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to add payment",
      "Payment saved as draft",
      async () => purchasePaymentService.createVendor(parseSaveVendorPaymentDto(req.body), await actor(req)),
      201,
    );
  };

  updateVendor = async (req: Request, res: Response) => {
    return handle(res, "Failed to save payment", "Payment saved", async () =>
      purchasePaymentService.updateVendor(
        parseRouteId(req.params.id),
        parseSaveVendorPaymentDto(req.body),
        await actor(req),
      ),
    );
  };

  createReimbursement = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to add reimbursement",
      "Reimbursement saved as draft",
      async () =>
        purchasePaymentService.createReimbursement(parseSaveReimbursementDto(req.body), await actor(req)),
      201,
    );
  };

  updateReimbursement = async (req: Request, res: Response) => {
    return handle(res, "Failed to save reimbursement", "Reimbursement saved", async () =>
      purchasePaymentService.updateReimbursement(
        parseRouteId(req.params.id),
        parseSaveReimbursementDto(req.body),
        await actor(req),
      ),
    );
  };

  remove = async (req: Request, res: Response) => {
    return handle(res, "Failed to delete payment", "Payment deleted", async () => {
      await purchasePaymentService.remove(parseRouteId(req.params.id), await actor(req));
      return null;
    });
  };

  submit = async (req: Request, res: Response) => {
    return handle(res, "Failed to send for approval", "Sent for approval", async () =>
      purchasePaymentService.submit(parseRouteId(req.params.id), await actor(req)),
    );
  };

  approve = async (req: Request, res: Response) => {
    return handle(res, "Failed to approve payment", "Payment approved", async () =>
      purchasePaymentService.approve(parseRouteId(req.params.id), await actor(req)),
    );
  };

  reject = async (req: Request, res: Response) => {
    return handle(res, "Failed to reject payment", "Payment rejected", async () =>
      purchasePaymentService.reject(
        parseRouteId(req.params.id),
        parseReasonDto(req.body).reason,
        await actor(req),
      ),
    );
  };

  approveItem = async (req: Request, res: Response) => {
    return handle(res, "Failed to approve nota", "Nota approved", async () =>
      purchasePaymentService.decideItem(
        parseRouteId(req.params.id),
        parseRouteId(req.params.itemId),
        { approve: true },
        await actor(req),
      ),
    );
  };

  rejectItem = async (req: Request, res: Response) => {
    return handle(res, "Failed to reject nota", "Nota rejected", async () =>
      purchasePaymentService.decideItem(
        parseRouteId(req.params.id),
        parseRouteId(req.params.itemId),
        { approve: false, reason: parseReasonDto(req.body).reason },
        await actor(req),
      ),
    );
  };

  cancel = async (req: Request, res: Response) => {
    return handle(res, "Failed to cancel payment", "Payment cancelled", async () =>
      purchasePaymentService.cancel(
        parseRouteId(req.params.id),
        parseReasonDto(req.body).reason,
        await actor(req),
      ),
    );
  };

  pay = async (req: Request, res: Response) => {
    return handle(res, "Failed to mark paid", "Marked as paid", async () =>
      purchasePaymentService.pay(
        parseRouteId(req.params.id),
        parsePayPurchasePaymentDto(req.body),
        await actor(req),
      ),
    );
  };

  addProofs = async (req: Request, res: Response) => {
    return handle(res, "Failed to upload files", "Files uploaded", async () =>
      purchasePaymentService.addProofs(
        parseRouteId(req.params.id),
        Array.isArray(req.files) ? req.files : [],
        await actor(req),
      ),
    );
  };

  removeProof = async (req: Request, res: Response) => {
    return handle(res, "Failed to remove file", "File removed", async () =>
      purchasePaymentService.removeProof(
        parseRouteId(req.params.id),
        parseRouteId(req.params.proofId),
        await actor(req),
      ),
    );
  };

  proof = async (req: Request, res: Response) => {
    try {
      const { stream, filename, contentType } = await purchasePaymentService.openProof(
        parseRouteId(req.params.id),
        parseRouteId(req.params.proofId),
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
}
