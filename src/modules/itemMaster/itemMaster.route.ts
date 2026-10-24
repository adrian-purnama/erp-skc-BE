import multer from "multer";
import { requireUser } from "../../middleware/requireUser";
import { createRouter } from "../../core/permissions/routing";
import { requirePermission } from "../../core/permissions/requirePermission";
import { ItemMasterController } from "./itemMaster.controller";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const router = createRouter();
const controller = new ItemMasterController();

router.get(
  "/tree",
  requireUser,
  requirePermission({ key: "itemMaster.view" }),
  controller.getTree,
);

router.get(
  "/folders/:id/children",
  requireUser,
  requirePermission({ key: "itemMaster.view" }),
  controller.getChildren,
);

router.post(
  "/folders",
  requireUser,
  requirePermission({ key: "itemMaster.manage" }),
  controller.createFolder,
);

router.patch(
  "/folders/:id",
  requireUser,
  requirePermission({ key: "itemMaster.manage" }),
  controller.updateFolder,
);

router.post(
  "/folders/:id/move",
  requireUser,
  requirePermission({ key: "itemMaster.manage" }),
  controller.moveFolder,
);

router.delete(
  "/folders/:id",
  requireUser,
  requirePermission({ key: "itemMaster.manage" }),
  controller.deleteFolder,
);

router.get(
  "/items/bulk/template",
  requireUser,
  requirePermission({ key: "itemMaster.manage" }),
  controller.downloadBulkTemplate,
);

router.post(
  "/items/bulk",
  requireUser,
  requirePermission({ key: "itemMaster.manage" }),
  upload.single("file"),
  controller.uploadBulk,
);

router.post(
  "/items",
  requireUser,
  requirePermission({ key: "itemMaster.manage" }),
  controller.createItem,
);

router.get(
  "/items/:id",
  requireUser,
  requirePermission({ key: "itemMaster.view" }),
  controller.getItem,
);

router.patch(
  "/items/:id",
  requireUser,
  requirePermission({ key: "itemMaster.manage" }),
  controller.updateItem,
);

router.post(
  "/items/:id/convert",
  requireUser,
  requirePermission({ key: "itemMaster.view" }),
  controller.convertItemQty,
);

router.post(
  "/items/:id/move",
  requireUser,
  requirePermission({ key: "itemMaster.manage" }),
  controller.moveItem,
);

router.delete(
  "/items/:id",
  requireUser,
  requirePermission({ key: "itemMaster.manage" }),
  controller.deleteItem,
);

export default router;
