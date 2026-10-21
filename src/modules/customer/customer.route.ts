import { requireUser } from "../../middleware/requireUser";
import { createRouter } from "../../core/permissions/routing";
import { requirePermission } from "../../core/permissions/requirePermission";
import { CustomerController } from "./customer.controller";

const router = createRouter();
const customerController = new CustomerController();

router.get(
  "/",
  requireUser,
  requirePermission({ key: "customer.view" }),
  customerController.list,
);

router.get(
  "/active",
  requireUser,
  requirePermission({ key: "customer.view" }),
  customerController.listActive,
);

router.get(
  "/:id",
  requireUser,
  requirePermission({ key: "customer.view" }),
  customerController.get,
);

router.post(
  "/",
  requireUser,
  requirePermission({ key: "customer.manage" }),
  customerController.create,
);

router.patch(
  "/:id",
  requireUser,
  requirePermission({ key: "customer.manage" }),
  customerController.update,
);

router.delete(
  "/:id",
  requireUser,
  requirePermission({ key: "customer.manage" }),
  customerController.remove,
);

export default router;
