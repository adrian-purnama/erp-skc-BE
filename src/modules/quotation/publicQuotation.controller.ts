import type { Request, Response } from "express";
import { fail, handle } from "../../dto/httpResponse";
import { parseVerifyToken } from "../../validation/projectQuotation";
import { quotationExportService } from "./quotation.export";
import { QuotationAccessError, quotationService } from "./quotation.service";

/** Client-facing quotation link (no login; the unguessable token is the credential). */
export class PublicQuotationController {
  view = async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    return handle(res, "Failed to open quotation", "Quotation", () =>
      quotationService.publicLookup(parseVerifyToken(req.params.token)),
    );
  };

  /** The company logo captured on this quotation (same as on its PDF). */
  logo = async (req: Request, res: Response) => {
    try {
      const doc = await quotationService.requireValidByToken(
        parseVerifyToken(req.params.token),
      );
      const logo = await quotationService.loadLogo(doc);
      if (!logo || !logo.contentType.startsWith("image/")) {
        return fail(res, null, "No logo", 404);
      }
      res.setHeader("Content-Type", logo.contentType);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.send(logo.buffer);
    } catch (error) {
      return fail(
        res,
        error,
        "Failed to load logo",
        error instanceof QuotationAccessError ? error.status : 400,
      );
    }
  };

  pdf = async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const { buffer, filename, contentType } =
        await quotationExportService.exportPublicPdf(
          parseVerifyToken(req.params.token),
        );
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(buffer);
    } catch (error) {
      return fail(
        res,
        error,
        "Failed to download quotation",
        error instanceof QuotationAccessError ? error.status : 400,
      );
    }
  };
}
