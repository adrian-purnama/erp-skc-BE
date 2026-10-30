import type { Request, Response } from "express";
import { fail, ok } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import { notificationService } from "./notification.service";

function requireAuthUserId(req: Request): string {
  const id = req.user?._id;
  if (!id) {
    throw new Error("Unauthorized");
  }
  return String(id);
}

export class NotificationController {
  list = async (req: Request, res: Response) => {
    try {
      const userId = requireAuthUserId(req);
      const limitRaw =
        typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const limit =
        limitRaw !== undefined && Number.isFinite(limitRaw)
          ? limitRaw
          : undefined;
      const data = await notificationService.list(userId, { limit });
      return ok(res, "Notifications retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to list notifications");
    }
  };

  unreadCount = async (req: Request, res: Response) => {
    try {
      const userId = requireAuthUserId(req);
      const data = await notificationService.unreadCount(userId);
      return ok(res, "Unread count retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to get unread count");
    }
  };

  markRead = async (req: Request, res: Response) => {
    try {
      const userId = requireAuthUserId(req);
      const id = parseRouteId(req.params.id);
      const data = await notificationService.markRead(userId, id);
      return ok(res, "Notification marked as read", data);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to mark as read";
      const status = message === "Notification not found" ? 404 : 400;
      return fail(res, error, "Failed to mark as read", status);
    }
  };

  markAllRead = async (req: Request, res: Response) => {
    try {
      const userId = requireAuthUserId(req);
      const data = await notificationService.markAllRead(userId);
      return ok(res, "All notifications marked as read", data);
    } catch (error) {
      return fail(res, error, "Failed to mark all as read");
    }
  };
}
