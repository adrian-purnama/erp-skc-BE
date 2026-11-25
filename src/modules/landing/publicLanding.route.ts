import { createRouter } from "../../core/permissions/routing";
import { publicRoute } from "../../core/permissions/requirePermission";
import { quoteRequestRateLimit } from "../../middleware/rateLimit";
import { LandingController } from "./landing.controller";

const router = createRouter();
const controller = new LandingController();

/** Published categories and posts for the public website build. */
router.get("/", publicRoute(), controller.publicContent);

/** Website "Request a quote" form; rate-limited per IP because each one sends an email. */
router.post("/contact", publicRoute(), quoteRequestRateLimit, controller.quoteRequest);

export default router;
