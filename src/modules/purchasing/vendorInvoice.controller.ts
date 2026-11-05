import type { Request, Response } from "express";
import { exportVendorInvoicePdf } from "./purchasingPdf";
import { getUserPermissions } from "../../core/permissions/resolve.service";
import { fail, handle } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import { parseReasonDto, parseSaveVendorInvoiceDto, parseVendorInvoiceStatusFilter } from "../../validation/purchasing";
import { queryString } from "../../validation/query";
import type { PoActor } from "./purchaseOrder.service";
import { vendorInvoiceService } from "./vendorInvoice.service";

async function actor(req: Request): Promise<PoActor> {
  if (!req.user?._id) throw new Error("Unauthorized");
  const perms = await getUserPermissions(req.user);
  return { userId: String(req.user._id), superAdmin: perms.has("*") };
}

export class VendorInvoiceController {
  queue = async (_req: Request, res: Response) => {
    return handle(res, "Failed to load receipts to invoice", "Receipts to invoice retrieved", () =>
      vendorInvoiceService.queue(),
    );
  };

  plan = async (req: Request, res: Response) => {
    return handle(res, "Failed to load invoice plan", "Invoice plan retrieved", () =>
      vendorInvoiceService.plan(parseRouteId(queryString(req.query.purchaseOrderId)), queryString(req.query.exceptId)),
    );
  };

  list = async (req: Request, res: Response) => {
    const purchaseOrderId = queryString(req.query.purchaseOrderId);
    return handle(res, "Failed to list vendor invoices", "Vendor invoices retrieved", () =>
      vendorInvoiceService.list({
        status: parseVendorInvoiceStatusFilter(queryString(req.query.status)),
        purchaseOrderId: purchaseOrderId ? parseRouteId(purchaseOrderId) : undefined,
        q: queryString(req.query.q),
      }),
    );
  };

  get = async (req: Request, res: Response) => {
    return handle(res, "Failed to get vendor invoice", "Vendor invoice retrieved", () =>
      vendorInvoiceService.get(parseRouteId(req.params.id)),
    );
  };

  create = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to add vendor invoice",
      "Vendor invoice saved as draft",
      async () => vendorInvoiceService.create(parseSaveVendorInvoiceDto(req.body), await actor(req)),
      201,
    );
  };

  update = async (req: Request, res: Response) => {
    return handle(res, "Failed to save vendor invoice", "Vendor invoice saved", () =>
      vendorInvoiceService.update(parseRouteId(req.params.id), parseSaveVendorInvoiceDto(req.body)),
    );
  };

  remove = async (req: Request, res: Response) => {
    return handle(res, "Failed to delete vendor invoice", "Vendor invoice deleted", async () => {
      await vendorInvoiceService.remove(parseRouteId(req.params.id));
      return null;
    });
  };

  post = async (req: Request, res: Response) => {
    return handle(res, "Failed to post vendor invoice", "Vendor invoice posted", async () =>
      vendorInvoiceService.post(parseRouteId(req.params.id), await actor(req)),
    );
  };

  void = async (req: Request, res: Response) => {
    return handle(res, "Failed to void vendor invoice", "Vendor invoice voided", async () =>
      vendorInvoiceService.void(parseRouteId(req.params.id), parseReasonDto(req.body).reason, await actor(req)),
    );
  };

  addFiles = async (req: Request, res: Response) => {
    return handle(res, "Failed to upload files", "Files uploaded", async () =>
      vendorInvoiceService.addFiles(
        parseRouteId(req.params.id),
        Array.isArray(req.files) ? req.files : [],
        await actor(req),
      ),
    );
  };

  removeFile = async (req: Request, res: Response) => {
    return handle(res, "Failed to remove file", "File removed", () =>
      vendorInvoiceService.removeFile(parseRouteId(req.params.id), parseRouteId(req.params.fileId)),
    );
  };

  file = async (req: Request, res: Response) => {
    try {
      const { stream, filename, contentType } = await vendorInvoiceService.openFile(
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

  pdf = async (req: Request, res: Response) => {
    try {
      const file = await exportVendorInvoicePdf(parseRouteId(req.params.id));
      res.setHeader("Content-Type", file.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
      return res.send(file.buffer);
    } catch (error) {
      return fail(res, error, "Failed to export PDF");
    }
  };
}
