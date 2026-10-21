import { createRouter } from "../../core/permissions/routing";
import { publicRoute } from "../../core/permissions/requirePermission";
import { AppConfigController } from "./AppConfig.controller";

const router = createRouter();
const appConfigController = new AppConfigController();

router.get("/branding", publicRoute(), appConfigController.getBranding);

export default router;
