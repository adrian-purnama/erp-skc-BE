import { createRouter } from "../../core/permissions/routing";
import { publicRoute } from "../../core/permissions/requirePermission";
import { PublicQuotationController } from "./publicQuotation.controller";

const router = createRouter();
const controller = new PublicQuotationController();

router.get("/:token", publicRoute(), controller.view);
router.get("/:token/pdf", publicRoute(), controller.pdf);
router.get("/:token/logo", publicRoute(), controller.logo);

export default router;
