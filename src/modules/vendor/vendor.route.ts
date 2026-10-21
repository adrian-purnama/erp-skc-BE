import { requireUser } from "../../middleware/requireUser";
import { createRouter } from "../../core/permissions/routing";
import { requirePermission } from "../../core/permissions/requirePermission";
import { VendorController } from "./vendor.controller";

const router = createRouter();
const vendorController = new VendorController();

router.get(
  "/",
  requireUser,
  requirePermission({ key: "vendor.view" }),
  vendorController.list,
);

router.get(
  "/active",
  requireUser,
  requirePermission({ key: "vendor.view" }),
  vendorController.listActive,
);

router.get(
  "/:id",
  requireUser,
  requirePermission({ key: "vendor.view" }),
  vendorController.get,
);

router.post(
  "/",
  requireUser,
  requirePermission({ key: "vendor.manage" }),
  vendorController.create,
);

router.patch(
  "/:id",
  requireUser,
  requirePermission({ key: "vendor.manage" }),
  vendorController.update,
);

router.delete(
  "/:id",
  requireUser,
  requirePermission({ key: "vendor.manage" }),
  vendorController.remove,
);

export default router;
