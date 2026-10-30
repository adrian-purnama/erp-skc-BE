import multer from "multer";
import { requireUser } from "../../middleware/requireUser";
import { createRouter } from "../../core/permissions/routing";
import { requirePermission } from "../../core/permissions/requirePermission";
import { ProductionController } from "./production.controller";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 12 },
});

const router = createRouter();
const productionController = new ProductionController();

router.get(
  "/projects/:projectId/readiness",
  requireUser,
  requirePermission({ key: "production.view" }),
  productionController.readiness,
);

router.post(
  "/projects/:projectId/release",
  requireUser,
  requirePermission({ key: "production.manage" }),
  productionController.release,
);

router.get(
  "/projects/:projectId/progress",
  requireUser,
  requirePermission({ key: "production.view" }),
  productionController.progress,
);

router.get(
  "/orders",
  requireUser,
  requirePermission({ key: "production.view" }),
  productionController.listOrders,
);

router.post(
  "/orders",
  requireUser,
  requirePermission({ key: "production.manage" }),
  productionController.createOrder,
);

router.get(
  "/pic-users",
  requireUser,
  // Also the receiver picker on handovers (manage implies handover).
  requirePermission({ key: "production.handover" }),
  productionController.picUsers,
);

router.get(
  "/orders/:id/pdf",
  requireUser,
  requirePermission({ key: "production.view" }),
  productionController.orderPdf,
);

router.get(
  "/orders/:id",
  requireUser,
  requirePermission({ key: "production.view" }),
  productionController.getOrder,
);

router.patch(
  "/orders/:id",
  requireUser,
  requirePermission({ key: "production.manage" }),
  productionController.updateOrder,
);

router.delete(
  "/orders/:id",
  requireUser,
  requirePermission({ key: "production.manage" }),
  productionController.deleteOrder,
);

router.post(
  "/orders/:id/release",
  requireUser,
  requirePermission({ key: "production.manage" }),
  productionController.releaseOrder,
);

router.post(
  "/orders/:id/revert",
  requireUser,
  requirePermission({ key: "production.manage" }),
  productionController.revertOrder,
);

router.post(
  "/orders/:id/complete",
  requireUser,
  requirePermission({ key: "production.manage" }),
  productionController.completeOrder,
);

router.post(
  "/orders/:id/cancel",
  requireUser,
  requirePermission({ key: "production.manage" }),
  productionController.cancelOrder,
);

router.post(
  "/orders/:id/reports",
  requireUser,
  requirePermission({ key: "production.report" }),
  productionController.addReport,
);

router.post(
  "/reports/:id/void",
  requireUser,
  requirePermission({ key: "production.manage" }),
  productionController.voidReport,
);

router.post(
  "/orders/:id/handovers",
  requireUser,
  requirePermission({ key: "production.handover" }),
  productionController.createHandover,
);

router.put(
  "/handovers/:id",
  requireUser,
  requirePermission({ key: "production.handover" }),
  productionController.updateHandover,
);

router.delete(
  "/handovers/:id",
  requireUser,
  requirePermission({ key: "production.handover" }),
  productionController.deleteHandover,
);

router.post(
  "/handovers/:id/post",
  requireUser,
  requirePermission({ key: "production.handover" }),
  productionController.postHandover,
);

router.post(
  "/handovers/:id/void",
  requireUser,
  requirePermission({ key: "production.manage" }),
  productionController.voidHandover,
);

router.get(
  "/handovers/:id/pdf",
  requireUser,
  requirePermission({ key: "production.view" }),
  productionController.handoverPdf,
);

router.get(
  "/handovers/:id/photos/:photoId",
  requireUser,
  requirePermission({ key: "production.view" }),
  productionController.handoverPhoto,
);

router.post(
  "/handovers/:id/photos",
  requireUser,
  requirePermission({ key: "production.handover" }),
  upload.array("files", 12),
  productionController.addHandoverPhotos,
);

router.delete(
  "/handovers/:id/photos/:photoId",
  requireUser,
  requirePermission({ key: "production.handover" }),
  productionController.removeHandoverPhoto,
);

router.post(
  "/orders/:id/dispatches",
  requireUser,
  requirePermission({ key: "production.dispatch" }),
  productionController.createDispatch,
);

router.put(
  "/dispatches/:id",
  requireUser,
  requirePermission({ key: "production.dispatch" }),
  productionController.updateDispatch,
);

router.delete(
  "/dispatches/:id",
  requireUser,
  requirePermission({ key: "production.dispatch" }),
  productionController.deleteDispatch,
);

router.post(
  "/dispatches/:id/submit",
  requireUser,
  requirePermission({ key: "production.dispatch" }),
  productionController.submitDispatch,
);

router.post(
  "/dispatches/:id/approve",
  requireUser,
  requirePermission({ key: "production.dispatchApprove" }),
  productionController.approveDispatch,
);

router.post(
  "/dispatches/:id/reject",
  requireUser,
  requirePermission({ key: "production.dispatchApprove" }),
  productionController.rejectDispatch,
);

router.post(
  "/dispatches/:id/send",
  requireUser,
  requirePermission({ key: "production.dispatch" }),
  productionController.sendDispatch,
);

router.post(
  "/dispatches/:id/cancel",
  requireUser,
  requirePermission({ key: "production.dispatch" }),
  productionController.cancelDispatch,
);

router.post(
  "/dispatches/:id/void",
  requireUser,
  requirePermission({ key: "production.dispatchApprove" }),
  productionController.voidDispatch,
);

router.get(
  "/dispatches/:id/pdf",
  requireUser,
  requirePermission({ key: "production.view" }),
  productionController.dispatchPdf,
);

router.get(
  "/dispatches/:id/photos/:photoId",
  requireUser,
  requirePermission({ key: "production.view" }),
  productionController.dispatchPhoto,
);

router.post(
  "/dispatches/:id/photos",
  requireUser,
  requirePermission({ key: "production.dispatch" }),
  upload.array("files", 12),
  productionController.addDispatchPhotos,
);

router.delete(
  "/dispatches/:id/photos/:photoId",
  requireUser,
  requirePermission({ key: "production.dispatch" }),
  productionController.removeDispatchPhoto,
);

export default router;
