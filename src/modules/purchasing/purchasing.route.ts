import multer from "multer";
import { requireUser } from "../../middleware/requireUser";
import { createRouter } from "../../core/permissions/routing";
import { requirePermission } from "../../core/permissions/requirePermission";
import { PurchaseOrderController } from "./purchaseOrder.controller";
import { GoodsReceiptController } from "./goodsReceipt.controller";
import { PurchaseRealizationController } from "./purchaseRealization.controller";
import { PurchasingController } from "./purchasing.controller";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 12 },
});

const router = createRouter();
const purchasingController = new PurchasingController();
const purchaseOrderController = new PurchaseOrderController();
const realizationController = new PurchaseRealizationController();
const receiptController = new GoodsReceiptController();

router.get(
  "/materials",
  requireUser,
  requirePermission({ key: "purchasing.request" }),
  purchasingController.materials,
);

router.get(
  "/projects",
  requireUser,
  requirePermission({ key: "purchasing.request" }),
  purchasingController.projects,
);

router.get(
  "/projects/:projectId/context",
  requireUser,
  requirePermission({ key: "purchasing.view" }),
  purchasingController.projectContext,
);

router.get(
  "/requests/plan/:productionOrderId",
  requireUser,
  requirePermission({ key: "purchasing.view" }),
  purchasingController.plan,
);

router.get(
  "/requests",
  requireUser,
  requirePermission({ key: "purchasing.view" }),
  purchasingController.list,
);

router.post(
  "/requests",
  requireUser,
  requirePermission({ key: "purchasing.request" }),
  purchasingController.create,
);

router.get(
  "/requests/:id",
  requireUser,
  requirePermission({ key: "purchasing.view" }),
  purchasingController.get,
);

router.put(
  "/requests/:id",
  requireUser,
  requirePermission({ key: "purchasing.request" }),
  purchasingController.update,
);

router.delete(
  "/requests/:id",
  requireUser,
  requirePermission({ key: "purchasing.request" }),
  purchasingController.remove,
);

router.post(
  "/requests/:id/submit",
  requireUser,
  requirePermission({ key: "purchasing.request" }),
  purchasingController.submit,
);

router.post(
  "/requests/:id/cancel",
  requireUser,
  requirePermission({ key: "purchasing.request" }),
  purchasingController.cancel,
);

router.post(
  "/requests/:id/decline",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  purchasingController.decline,
);

router.get(
  "/vendors",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  purchaseOrderController.vendors,
);

router.get(
  "/terms",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  purchaseOrderController.terms,
);

router.get(
  "/orders/open-lines",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  purchaseOrderController.openLines,
);

router.get(
  "/orders/mine",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  purchaseOrderController.mine,
);

router.get(
  "/orders/approvals",
  requireUser,
  requirePermission({ key: "purchasing.approve" }),
  purchaseOrderController.approvals,
);

router.post(
  "/orders",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  purchaseOrderController.create,
);

router.get(
  "/orders/:id/pdf",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  purchaseOrderController.pdf,
);

router.get(
  "/orders/:id",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  purchaseOrderController.get,
);

router.put(
  "/orders/:id",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  purchaseOrderController.update,
);

router.delete(
  "/orders/:id",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  purchaseOrderController.remove,
);

router.post(
  "/orders/:id/submit",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  purchaseOrderController.submit,
);

router.post(
  "/orders/:id/approve",
  requireUser,
  requirePermission({ key: "purchasing.approve" }),
  purchaseOrderController.approve,
);

router.post(
  "/orders/:id/reject",
  requireUser,
  requirePermission({ key: "purchasing.approve" }),
  purchaseOrderController.reject,
);

router.post(
  "/orders/:id/revise",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  purchaseOrderController.revise,
);

router.post(
  "/orders/:id/cancel",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  purchaseOrderController.cancel,
);

router.get(
  "/realizations/buyers",
  requireUser,
  requirePermission({ key: "purchasing.realize" }),
  realizationController.buyers,
);

router.get(
  "/realizations/queue",
  requireUser,
  requirePermission({ key: "purchasing.realize" }),
  realizationController.queue,
);

router.get(
  "/realizations/plan/:orderId",
  requireUser,
  requirePermission({ key: "purchasing.realize" }),
  realizationController.plan,
);

router.get(
  "/realizations",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  realizationController.list,
);

router.post(
  "/realizations",
  requireUser,
  requirePermission({ key: "purchasing.realize" }),
  realizationController.create,
);

router.get(
  "/realizations/:id/photos/:photoId",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  realizationController.photo,
);

router.post(
  "/realizations/:id/photos",
  requireUser,
  requirePermission({ key: "purchasing.realize" }),
  upload.array("files", 12),
  realizationController.addPhotos,
);

router.delete(
  "/realizations/:id/photos/:photoId",
  requireUser,
  requirePermission({ key: "purchasing.realize" }),
  realizationController.removePhoto,
);

router.get(
  "/realizations/:id",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  realizationController.get,
);

router.put(
  "/realizations/:id",
  requireUser,
  requirePermission({ key: "purchasing.realize" }),
  realizationController.update,
);

router.delete(
  "/realizations/:id",
  requireUser,
  requirePermission({ key: "purchasing.realize" }),
  realizationController.remove,
);

router.post(
  "/realizations/:id/post",
  requireUser,
  requirePermission({ key: "purchasing.realize" }),
  realizationController.post,
);

router.post(
  "/realizations/:id/void",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  realizationController.void,
);

router.get(
  "/receipts/receivers",
  requireUser,
  requirePermission({ key: "purchasing.receive" }),
  receiptController.receivers,
);

router.get(
  "/receipts/queue",
  requireUser,
  requirePermission({ key: "purchasing.receive" }),
  receiptController.queue,
);

router.get(
  "/receipts/plan/:orderId",
  requireUser,
  requirePermission({ key: "purchasing.receive" }),
  receiptController.plan,
);

router.get(
  "/receipts",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  receiptController.list,
);

router.post(
  "/receipts",
  requireUser,
  requirePermission({ key: "purchasing.receive" }),
  receiptController.create,
);

router.get(
  "/receipts/:id",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  receiptController.get,
);

router.post(
  "/receipts/:id/void",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  receiptController.void,
);

export default router;
