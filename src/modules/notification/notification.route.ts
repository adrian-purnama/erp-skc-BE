import { requireUser } from "../../middleware/requireUser";
import { createRouter } from "../../core/permissions/routing";
import { NotificationController } from "./notification.controller";

const router = createRouter();
const notificationController = new NotificationController();

router.get("/", requireUser, notificationController.list);
router.get("/unread-count", requireUser, notificationController.unreadCount);
router.patch("/:id/read", requireUser, notificationController.markRead);
router.post("/read-all", requireUser, notificationController.markAllRead);

export default router;
