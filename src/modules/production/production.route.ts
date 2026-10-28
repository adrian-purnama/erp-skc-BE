import { requireUser } from "../../middleware/requireUser";
import { createRouter } from "../../core/permissions/routing";
import { requirePermission } from "../../core/permissions/requirePermission";
import { ProductionController } from "./production.controller";

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
  requirePermission({ key: "production.manage" }),
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

export default router;
