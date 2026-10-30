import { requireUser } from "../../middleware/requireUser";
import { createRouter } from "../../core/permissions/routing";
import { requirePermission } from "../../core/permissions/requirePermission";
import { QuotationController } from "./quotation.controller";

const router = createRouter();
const quotationController = new QuotationController();

router.get(
  "/project/:projectId",
  requireUser,
  requirePermission({ key: "quotation.view" }),
  quotationController.overview,
);

router.post(
  "/project/:projectId",
  requireUser,
  requirePermission({ key: "quotation.manage" }),
  quotationController.createDraft,
);

router.get(
  "/:id",
  requireUser,
  requirePermission({ key: "quotation.view" }),
  quotationController.get,
);

router.get(
  "/:id/export",
  requireUser,
  requirePermission({ key: "quotation.view" }),
  quotationController.export,
);

router.patch(
  "/:id",
  requireUser,
  requirePermission({ key: "quotation.manage" }),
  quotationController.update,
);

router.patch(
  "/:id/lines/:lineKey",
  requireUser,
  requirePermission({ key: "quotation.manage" }),
  quotationController.patchLine,
);

router.post(
  "/:id/resync",
  requireUser,
  requirePermission({ key: "quotation.manage" }),
  quotationController.resync,
);

router.post(
  "/:id/issue",
  requireUser,
  requirePermission({ key: "quotation.issue" }),
  quotationController.issue,
);

router.post(
  "/:id/reissue",
  requireUser,
  requirePermission({ key: "quotation.issue" }),
  quotationController.reissue,
);

router.post(
  "/:id/won",
  requireUser,
  requirePermission({ key: "quotation.won" }),
  quotationController.markWon,
);

router.delete(
  "/:id/won",
  requireUser,
  requirePermission({ key: "quotation.won" }),
  quotationController.unmarkWon,
);

router.delete(
  "/:id",
  requireUser,
  requirePermission({ key: "quotation.manage" }),
  quotationController.discard,
);

export default router;
