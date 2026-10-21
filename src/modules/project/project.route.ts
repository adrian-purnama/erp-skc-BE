import multer from "multer";
import { requireUser } from "../../middleware/requireUser";
import { createRouter } from "../../core/permissions/routing";
import { requirePermission } from "../../core/permissions/requirePermission";
import { ProjectController } from "./project.controller";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const router = createRouter();
const projectController = new ProjectController();

router.get(
  "/",
  requireUser,
  requirePermission({ key: "project.view" }),
  projectController.list,
);

router.post(
  "/",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.create,
);

router.get(
  "/calendar/agenda",
  requireUser,
  requirePermission({ key: "project.view" }),
  projectController.calendarAgenda,
);

router.get(
  "/:id/calendar",
  requireUser,
  requirePermission({ key: "project.view" }),
  projectController.listCalendar,
);

router.post(
  "/:id/calendar",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.createCalendarEvent,
);

router.patch(
  "/:id/calendar/:eventId",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.updateCalendarEvent,
);

router.delete(
  "/:id/calendar/:eventId",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.deleteCalendarEvent,
);

router.get(
  "/:id/documents",
  requireUser,
  requirePermission({ key: "project.view" }),
  projectController.listDocuments,
);

router.post(
  "/:id/documents/:kind",
  requireUser,
  requirePermission({ key: "project.manage" }),
  upload.single("file"),
  projectController.uploadDocument,
);

router.get(
  "/:id/documents/:docId/download",
  requireUser,
  requirePermission({ key: "project.view" }),
  projectController.downloadDocument,
);

router.post(
  "/:id/documents/:docId/current",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.setCurrentDocument,
);

router.patch(
  "/:id/documents/:docId",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.renameDocument,
);

router.delete(
  "/:id/documents/:docId",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.deleteDocument,
);

router.get(
  "/:id/loose-files",
  requireUser,
  requirePermission({ key: "project.view" }),
  projectController.listLooseFiles,
);

router.post(
  "/:id/loose-files/:kind",
  requireUser,
  requirePermission({ key: "project.manage" }),
  upload.single("file"),
  projectController.uploadLooseFile,
);

router.get(
  "/:id/loose-files/:fileId/download",
  requireUser,
  requirePermission({ key: "project.view" }),
  projectController.downloadLooseFile,
);

router.patch(
  "/:id/loose-files/:fileId",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.renameLooseFile,
);

router.delete(
  "/:id/loose-files/:fileId",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.deleteLooseFile,
);

router.get(
  "/:id/shop-drawing/boq/materials",
  requireUser,
  requirePermission({ key: "project.view" }),
  projectController.listShopDrawingBoqMaterials,
);

router.get(
  "/:id/shop-drawing/boq/summary",
  requireUser,
  requirePermission({ key: "project.view" }),
  projectController.shopDrawingBoqSummary,
);

router.get(
  "/:id/shop-drawing/boq",
  requireUser,
  requirePermission({ key: "project.view" }),
  projectController.getShopDrawingBoq,
);

router.put(
  "/:id/shop-drawing/boq",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.upsertShopDrawingBoq,
);

router.delete(
  "/:id/shop-drawing/boq/:boqId",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.deleteShopDrawingBoq,
);

router.get(
  "/:id/rab",
  requireUser,
  requirePermission({ key: "project.view" }),
  projectController.getRab,
);

router.get(
  "/:id/rab/elaboration",
  requireUser,
  requirePermission({ key: "project.view" }),
  projectController.rabElaboration,
);

router.post(
  "/:id/rab/lock",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.lockRab,
);

router.post(
  "/:id/rab/lines/:lineKey/fill-tarif",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.fillRabLineTarif,
);

router.patch(
  "/:id/rab/lines/:lineKey",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.patchRabLine,
);

router.get(
  "/:id/shop-drawing",
  requireUser,
  requirePermission({ key: "project.view" }),
  projectController.listShopDrawing,
);

router.post(
  "/:id/shop-drawing/items",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.createShopDrawingItem,
);

router.patch(
  "/:id/shop-drawing/items/:itemId",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.renameShopDrawingItem,
);

router.delete(
  "/:id/shop-drawing/items/:itemId",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.deleteShopDrawingItem,
);

router.post(
  "/:id/shop-drawing/items/:itemId/files",
  requireUser,
  requirePermission({ key: "project.manage" }),
  upload.single("file"),
  projectController.uploadShopDrawingFile,
);

router.get(
  "/:id/shop-drawing/files/:fileId/download",
  requireUser,
  requirePermission({ key: "project.view" }),
  projectController.downloadShopDrawingFile,
);

router.post(
  "/:id/shop-drawing/files/:fileId/current",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.setCurrentShopDrawingFile,
);

router.delete(
  "/:id/shop-drawing/files/:fileId",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.deleteShopDrawingFile,
);

router.get(
  "/:id",
  requireUser,
  requirePermission({ key: "project.view" }),
  projectController.get,
);

router.patch(
  "/:id",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.update,
);

router.delete(
  "/:id",
  requireUser,
  requirePermission({ key: "project.manage" }),
  projectController.remove,
);

export default router;
