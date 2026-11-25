import multer from "multer";
import { requireUser } from "../../middleware/requireUser";
import { createRouter } from "../../core/permissions/routing";
import { requirePermission } from "../../core/permissions/requirePermission";
import { LANDING_MAX_UPLOAD_BYTES, LandingController } from "./landing.controller";

/** One image per request so the browser can show progress per file. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LANDING_MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only images allowed"));
      return;
    }
    cb(null, true);
  },
});

const router = createRouter();
const controller = new LandingController();

router.get("/categories", requireUser, requirePermission({ key: "landing.view" }), controller.listCategories);
router.post("/categories", requireUser, requirePermission({ key: "landing.manage" }), controller.createCategory);
router.put("/categories/order", requireUser, requirePermission({ key: "landing.manage" }), controller.reorderCategories);
router.put("/categories/:id", requireUser, requirePermission({ key: "landing.manage" }), controller.updateCategory);
router.delete("/categories/:id", requireUser, requirePermission({ key: "landing.manage" }), controller.deleteCategory);

router.get("/posts", requireUser, requirePermission({ key: "landing.view" }), controller.listPosts);
router.post("/posts", requireUser, requirePermission({ key: "landing.manage" }), controller.createPost);
router.get("/posts/:id", requireUser, requirePermission({ key: "landing.view" }), controller.getPost);
router.put("/posts/:id", requireUser, requirePermission({ key: "landing.manage" }), controller.updatePost);
router.delete("/posts/:id", requireUser, requirePermission({ key: "landing.manage" }), controller.deletePost);

router.post(
  "/posts/:id/cover",
  requireUser,
  requirePermission({ key: "landing.manage" }),
  upload.single("file"),
  controller.setCover,
);
router.post(
  "/posts/:id/logo",
  requireUser,
  requirePermission({ key: "landing.manage" }),
  upload.single("file"),
  controller.setLogo,
);
router.delete("/posts/:id/logo", requireUser, requirePermission({ key: "landing.manage" }), controller.removeLogo);
router.post(
  "/posts/:id/gallery",
  requireUser,
  requirePermission({ key: "landing.manage" }),
  upload.single("file"),
  controller.addGalleryImage,
);
router.put(
  "/posts/:id/gallery/order",
  requireUser,
  requirePermission({ key: "landing.manage" }),
  controller.reorderGallery,
);
router.delete(
  "/posts/:id/gallery/:imageId",
  requireUser,
  requirePermission({ key: "landing.manage" }),
  controller.removeGalleryImage,
);

export default router;
