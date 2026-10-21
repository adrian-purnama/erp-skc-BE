import { requireUser } from "../../middleware/requireUser";
import { createRouter } from "../../core/permissions/routing";
import { publicRoute } from "../../core/permissions/requirePermission";
import { AuthController } from "./auth.controller";

const router = createRouter();
const authController = new AuthController();

router.post("/otp", publicRoute(), authController.sendOtp);
router.post("/register", publicRoute(), authController.register);
router.post("/login", publicRoute(), authController.login);
router.post("/reset-password", publicRoute(), authController.resetPassword);
router.get("/validate", requireUser, authController.validateUser);

export default router;
