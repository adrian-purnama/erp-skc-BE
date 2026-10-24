import { requireUser } from "../../middleware/requireUser";
import { createRouter } from "../../core/permissions/routing";
import { requirePermission } from "../../core/permissions/requirePermission";
import { TermOfPaymentController } from "./termOfPayment.controller";

const router = createRouter();
const termOfPaymentController = new TermOfPaymentController();

router.get(
  "/",
  requireUser,
  requirePermission({ key: "termOfPayment.view" }),
  termOfPaymentController.list,
);

router.get(
  "/:id",
  requireUser,
  requirePermission({ key: "termOfPayment.view" }),
  termOfPaymentController.get,
);

router.post(
  "/",
  requireUser,
  requirePermission({ key: "termOfPayment.manage" }),
  termOfPaymentController.create,
);

router.put(
  "/:id",
  requireUser,
  requirePermission({ key: "termOfPayment.manage" }),
  termOfPaymentController.update,
);

router.delete(
  "/:id",
  requireUser,
  requirePermission({ key: "termOfPayment.manage" }),
  termOfPaymentController.remove,
);

export default router;
