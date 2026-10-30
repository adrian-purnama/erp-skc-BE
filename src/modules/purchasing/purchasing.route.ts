import multer from "multer";
import { requireUser } from "../../middleware/requireUser";
import { createRouter } from "../../core/permissions/routing";
import { requirePermission } from "../../core/permissions/requirePermission";
import { PurchaseOrderController } from "./purchaseOrder.controller";
import { PurchaseRabController } from "./purchaseRab.controller";
import { PurchaseRealizationController } from "./purchaseRealization.controller";
import { PurchasingController } from "./purchasing.controller";
import { PurchasePaymentController } from "./purchasePayment.controller";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 12 },
});

const router = createRouter();
const purchasingController = new PurchasingController();
const purchaseOrderController = new PurchaseOrderController();
const realizationController = new PurchaseRealizationController();
const rabController = new PurchaseRabController();
const paymentController = new PurchasePaymentController();

router.get(
  "/materials",
  requireUser,
  requirePermission({ key: "purchasing.request" }),
  purchasingController.materials,
);

router.get(
  "/spks/mine",
  requireUser,
  requirePermission({ key: "purchasing.request" }),
  purchasingController.mySpks,
);

router.get(
  "/projects/:projectId/context",
  requireUser,
  requirePermission({ key: "purchasing.view" }),
  purchasingController.projectContext,
);

router.get(
  "/rabs",
  requireUser,
  requirePermission({ key: "purchasing.view" }),
  rabController.list,
);

router.get(
  "/rabs/requestable",
  requireUser,
  requirePermission({ key: "purchasing.request" }),
  rabController.requestable,
);

router.get(
  "/rabs/materials",
  requireUser,
  requirePermission({ key: "purchasing.rab" }),
  purchasingController.materials,
);

router.post(
  "/rabs",
  requireUser,
  requirePermission({ key: "purchasing.rab" }),
  rabController.create,
);

router.get(
  "/rabs/:id",
  requireUser,
  requirePermission({ key: "purchasing.view" }),
  rabController.get,
);

router.put(
  "/rabs/:id",
  requireUser,
  requirePermission({ key: "purchasing.rab" }),
  rabController.update,
);

router.delete(
  "/rabs/:id",
  requireUser,
  requirePermission({ key: "purchasing.rab" }),
  rabController.remove,
);

router.post(
  "/rabs/:id/lock",
  requireUser,
  requirePermission({ key: "purchasing.rab" }),
  rabController.lock,
);

router.post(
  "/rabs/:id/unlock",
  requireUser,
  requirePermission({ key: "purchasing.rab" }),
  rabController.unlock,
);

router.get(
  "/requests/rab-plan/:purchaseRabId",
  requireUser,
  requirePermission({ key: "purchasing.view" }),
  purchasingController.rabPlan,
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
  "/requests/:id/received",
  requireUser,
  requirePermission({ key: "purchasing.request" }),
  purchasingController.confirmReceived,
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
  "/orders/payable",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  paymentController.listPayable,
);

// Level 1 and level 2 approvers both hold viewAll; the service checks the chosen approver.
router.get(
  "/orders/approvals",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  purchaseOrderController.approvals,
);

router.get(
  "/orders/approvers",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  purchaseOrderController.approvers,
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
  "/orders/:id/rab-compare",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  purchaseOrderController.rabCompare,
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
  requirePermission({ key: "purchasing.viewAll" }),
  purchaseOrderController.approve,
);

router.post(
  "/orders/:id/reject",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  purchaseOrderController.reject,
);

router.get(
  "/orders/:id/quotations/:fileId",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  purchaseOrderController.quotation,
);

router.post(
  "/orders/:id/quotations",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  upload.single("file"),
  purchaseOrderController.uploadQuotation,
);

router.patch(
  "/orders/:id/estimates",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  purchaseOrderController.setEstimates,
);

router.post(
  "/orders/:id/quotations/:fileId/current",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  purchaseOrderController.setCurrentQuotation,
);

router.patch(
  "/orders/:id/quotations/:fileId",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  purchaseOrderController.renameQuotation,
);

router.delete(
  "/orders/:id/quotations/:fileId",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  purchaseOrderController.removeQuotation,
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
  "/flow",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  purchasingController.flow,
);

// Payments: owner / approver / finance rules are checked in the service.

router.get(
  "/payments",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  paymentController.list,
);

router.get(
  "/payments/approvals",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  paymentController.approvals,
);

router.get(
  "/payments/reimbursable",
  requireUser,
  requirePermission({ key: "purchasing.realize" }),
  paymentController.reimbursable,
);

router.get(
  "/orders/:id/payments",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  paymentController.forOrder,
);

router.post(
  "/payments/vendor",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  paymentController.createVendor,
);

router.post(
  "/payments/reimburse",
  requireUser,
  requirePermission({ key: "purchasing.realize" }),
  paymentController.createReimbursement,
);

router.get(
  "/payments/:id",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  paymentController.get,
);

router.put(
  "/payments/:id/vendor",
  requireUser,
  requirePermission({ key: "purchasing.manage" }),
  paymentController.updateVendor,
);

router.put(
  "/payments/:id/reimburse",
  requireUser,
  requirePermission({ key: "purchasing.realize" }),
  paymentController.updateReimbursement,
);

router.delete(
  "/payments/:id",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  paymentController.remove,
);

router.post(
  "/payments/:id/submit",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  paymentController.submit,
);

router.post(
  "/payments/:id/approve",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  paymentController.approve,
);

router.post(
  "/payments/:id/reject",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  paymentController.reject,
);

router.post(
  "/payments/:id/items/:itemId/approve",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  paymentController.approveItem,
);

router.post(
  "/payments/:id/items/:itemId/reject",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  paymentController.rejectItem,
);

router.post(
  "/payments/:id/cancel",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  paymentController.cancel,
);

router.post(
  "/payments/:id/pay",
  requireUser,
  requirePermission({ key: "purchasing.pay" }),
  paymentController.pay,
);

router.get(
  "/payments/:id/proofs/:proofId",
  requireUser,
  requirePermission({ key: "purchasing.viewAll" }),
  paymentController.proof,
);

router.post(
  "/payments/:id/proofs",
  requireUser,
  requirePermission({ key: "purchasing.pay" }),
  upload.array("files", 12),
  paymentController.addProofs,
);

router.delete(
  "/payments/:id/proofs/:proofId",
  requireUser,
  requirePermission({ key: "purchasing.pay" }),
  paymentController.removeProof,
);

export default router;
