import type { Request, Response } from "express";
import { fail, handle, ok } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import { queryString } from "../../validation/query";
import {
  parsePatchProjectQuotationLineDto,
  parseQuotationLineKey,
  parseUpdateProjectQuotationDto,
} from "../../validation/projectQuotation";
import { quotationExportService } from "./quotation.export";
import { quotationService } from "./quotation.service";

function userId(req: Request): string {
  if (!req.user?._id) throw new Error("Unauthorized");
  return String(req.user._id);
}

export class QuotationController {
  overview = async (req: Request, res: Response) => {
    return handle(res, "Failed to load quotations", "Quotations retrieved", () =>
      quotationService.overview(parseRouteId(req.params.projectId)),
    );
  };

  createDraft = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to create quotation revision",
      "Quotation revision created",
      () =>
        quotationService.createDraft(
          parseRouteId(req.params.projectId),
          userId(req),
        ),
      201,
    );
  };

  get = async (req: Request, res: Response) => {
    try {
      const data = await quotationService.getById(parseRouteId(req.params.id));
      if (!data) return fail(res, null, "Quotation not found", 404);
      return ok(res, "Quotation retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to get quotation");
    }
  };

  update = async (req: Request, res: Response) => {
    return handle(res, "Failed to update quotation", "Quotation updated", () =>
      quotationService.update(
        parseRouteId(req.params.id),
        parseUpdateProjectQuotationDto(req.body),
      ),
    );
  };

  patchLine = async (req: Request, res: Response) => {
    return handle(res, "Failed to update line", "Line updated", () =>
      quotationService.patchLine(
        parseRouteId(req.params.id),
        parseQuotationLineKey(req.params.lineKey),
        parsePatchProjectQuotationLineDto(req.body),
      ),
    );
  };

  resync = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to resync quotation",
      "Quotation resynced from RAB",
      () => quotationService.resync(parseRouteId(req.params.id)),
    );
  };

  issue = async (req: Request, res: Response) => {
    return handle(res, "Failed to issue quotation", "Quotation issued", () =>
      quotationService.issue(parseRouteId(req.params.id), userId(req)),
    );
  };

  discard = async (req: Request, res: Response) => {
    return handle(res, "Failed to discard draft", "Draft discarded", async () => {
      await quotationService.discardDraft(parseRouteId(req.params.id));
      return null;
    });
  };

  export = async (req: Request, res: Response) => {
    try {
      const format = queryString(req.query.format) ?? "xlsx";
      if (format !== "xlsx" && format !== "pdf") {
        throw new Error("format must be xlsx or pdf");
      }
      const { buffer, filename, contentType } =
        await quotationExportService.export(parseRouteId(req.params.id), format);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(buffer);
    } catch (error) {
      return fail(res, error, "Failed to export quotation");
    }
  };
}
