import { requireUser } from "../../middleware/requireUser";
import { createRouter } from "../../core/permissions/routing";
import { requirePermission } from "../../core/permissions/requirePermission";
import { UomController } from "./uom.controller";

const router = createRouter();
const uomController = new UomController();

router.get(
  "/",
  requireUser,
  requirePermission({ key: "uom.view" }),
  uomController.list,
);

router.get(
  "/:id",
  requireUser,
  requirePermission({ key: "uom.view" }),
  uomController.get,
);

router.post(
  "/",
  requireUser,
  requirePermission({ key: "uom.manage" }),
  uomController.create,
);

router.put(
  "/:id",
  requireUser,
  requirePermission({ key: "uom.manage" }),
  uomController.update,
);

router.delete(
  "/:id",
  requireUser,
  requirePermission({ key: "uom.manage" }),
  uomController.remove,
);

export default router;
