import multer from "multer";
import { requireUser } from "../../middleware/requireUser";
import { createRouter } from "../../core/permissions/routing";
import { requirePermission } from "../../core/permissions/requirePermission";
import { AdminController } from "./admin.controller";
import { AuditController } from "./audit/audit.controller";
import { RoleController } from "./roles/role.controller";
import { PermissionController } from "./permissions/permission.controller";
import { ShrinkDbController } from "./shrinkDb/shrinkDb.controller";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only images allowed"));
      return;
    }
    cb(null, true);
  },
});

const router = createRouter();
const adminController = new AdminController();
const auditController = new AuditController();
const roleController = new RoleController();
const permissionController = new PermissionController();
const shrinkDbController = new ShrinkDbController();

router.get(
  "/app-config",
  requireUser,
  requirePermission({ key: "admin.config.view" }),
  adminController.getAppConfig,
);

router.patch(
  "/app-config",
  requireUser,
  requirePermission({ key: "admin.config.manage" }),
  adminController.updateAppConfig,
);

router.post(
  "/app-logo",
  requireUser,
  requirePermission({ key: "admin.config.manage" }),
  upload.single("file"),
  adminController.updateAppLogo,
);

router.post(
  "/app-company-profile",
  requireUser,
  requirePermission({ key: "admin.config.manage" }),
  upload.single("file"),
  adminController.updateCompanyProfile,
);

router.get(
  "/users",
  requireUser,
  requirePermission({ key: "admin.user.view" }),
  adminController.searchUsers,
);
router.get(
  "/users/:id",
  requireUser,
  requirePermission({ key: "admin.user.view" }),
  adminController.getUser,
);
router.patch(
  "/users/:id",
  requireUser,
  requirePermission({ key: "admin.user.manage" }),
  adminController.updateUser,
);
router.patch(
  "/users/:id/roles",
  requireUser,
  requirePermission({ key: "admin.role.manage" }),
  roleController.updateUserRoles,
);

router.get(
  "/permissions",
  requireUser,
  requirePermission({ key: "admin.role.view" }),
  permissionController.list,
);
router.get(
  "/permissions/scan-report",
  requireUser,
  requirePermission({ key: "admin.role.view" }),
  permissionController.scanReport,
);
router.post(
  "/permissions/sync",
  requireUser,
  requirePermission({ key: "admin.role.manage" }),
  permissionController.sync,
);

router.get(
  "/audit/collections",
  requireUser,
  requirePermission({ key: "admin.audit.view" }),
  auditController.listCollections,
);
router.get(
  "/audit/:collection",
  requireUser,
  requirePermission({ key: "admin.audit.view" }),
  auditController.list,
);
router.get(
  "/audit/:collection/:id",
  requireUser,
  requirePermission({ key: "admin.audit.view" }),
  auditController.get,
);

router.post(
  "/shrink-db",
  requireUser,
  requirePermission({ key: "admin.shrinkDb.run" }),
  shrinkDbController.start,
);
router.get(
  "/shrink-db/status",
  requireUser,
  requirePermission({ key: "admin.shrinkDb.run" }),
  shrinkDbController.status,
);
router.post(
  "/shrink-db/orphans",
  requireUser,
  requirePermission({ key: "admin.shrinkDb.run" }),
  shrinkDbController.orphans,
);
router.post(
  "/shrink-db/orphans/purge",
  requireUser,
  requirePermission({ key: "admin.shrinkDb.run" }),
  shrinkDbController.purgeOrphans,
);

router.get(
  "/roles",
  requireUser,
  requirePermission({ key: "admin.role.view" }),
  roleController.list,
);
router.get(
  "/roles/:key",
  requireUser,
  requirePermission({ key: "admin.role.view" }),
  roleController.get,
);
router.post(
  "/roles",
  requireUser,
  requirePermission({ key: "admin.role.manage" }),
  roleController.create,
);
router.patch(
  "/roles/:key",
  requireUser,
  requirePermission({ key: "admin.role.manage" }),
  roleController.update,
);
router.delete(
  "/roles/:key",
  requireUser,
  requirePermission({ key: "admin.role.manage" }),
  roleController.remove,
);

export default router;
