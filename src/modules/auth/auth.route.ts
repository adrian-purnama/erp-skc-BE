import multer from "multer";
import { requireUser } from "../../middleware/requireUser";
import { createRouter } from "../../core/permissions/routing";
import { publicRoute } from "../../core/permissions/requirePermission";
import { AuthController } from "./auth.controller";

const profilePictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "image/png" && file.mimetype !== "image/jpeg") {
      cb(new Error("Profile picture must be a PNG or JPG"));
      return;
    }
    cb(null, true);
  },
});

const router = createRouter();
const authController = new AuthController();

router.post("/otp", publicRoute(), authController.sendOtp);
router.post("/register", publicRoute(), authController.register);
router.post("/login", publicRoute(), authController.login);
router.post("/reset-password", publicRoute(), authController.resetPassword);
router.get("/validate", requireUser, authController.validateUser);
router.get("/profile", requireUser, authController.getProfile);
router.patch("/profile", requireUser, authController.updateProfile);
router.post(
  "/profile/picture",
  requireUser,
  profilePictureUpload.single("file"),
  authController.uploadProfilePicture,
);

export default router;
