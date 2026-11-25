import { Types } from "mongoose";
import { logger } from "../../core/logger";
import type {
  NotificationListOutDto,
  NotificationMarkAllReadOutDto,
  NotificationMarkReadOutDto,
  NotificationOutDto,
  NotificationUnreadCountOutDto,
  NotifyInDto,
} from "../../dto/notification.dto";
import {
  NotificationModel,
  type NotificationInterface,
} from "../../models/notification.model";
import { userEmailsById } from "../auth";
import { emailService } from "../email";

type NotificationDoc = NotificationInterface & {
  _id: Types.ObjectId;
  createdAt: Date;
};

function toOut(doc: NotificationDoc): NotificationOutDto {
  return {
    id: String(doc._id),
    title: doc.title,
    body: doc.body,
    link: doc.link ?? null,
    readAt: doc.readAt ? doc.readAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
  };
}

class NotificationService {
  private readonly source = "modules/notification/notification.service.ts";

  async notify(input: NotifyInDto): Promise<{ created: number }> {
    const title = input.title.trim();
    const body = input.body.trim();
    if (!title || !body) {
      throw new Error("title and body are required");
    }

    const linkRaw = input.link?.trim() || null;
    const link = linkRaw
      ? linkRaw.startsWith("/")
        ? linkRaw
        : `/${linkRaw}`
      : null;
    const html = input.html?.trim() || null;

    const userIds = [
      ...new Set(
        input.userIds
          .map(String)
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ];
    if (userIds.length === 0) {
      return { created: 0 };
    }

    const channels = new Set(input.channels ?? ["in_app", "email"]);
    const wantEmail = channels.has("email");
    if (!channels.has("in_app") && !wantEmail) {
      return { created: 0 };
    }

    const docs = userIds.map((userId) => ({
      userId: new Types.ObjectId(userId),
      title,
      body,
      link,
      readAt: null,
      emailSentAt: null,
    }));

    const inserted = await NotificationModel.insertMany(docs);
    const createdIds = inserted.map((d) => d._id as Types.ObjectId);

    if (wantEmail && createdIds.length > 0) {
      const emailByUser = await userEmailsById(userIds);
      await Promise.all(
        userIds.map(async (userId, index) => {
          const to = emailByUser.get(userId);
          const docId = createdIds[index];
          if (!to || !docId) return;
          try {
            const ok = await emailService.sendNotification(to, {
              title,
              body,
              link,
              html,
            });
            if (ok) {
              await NotificationModel.updateOne(
                { _id: docId },
                { $set: { emailSentAt: new Date() } },
              ).exec();
            }
          } catch (error) {
            logger.error(
              error instanceof Error ? error.message : String(error),
              this.source,
              "notify",
            );
          }
        }),
      );
    }

    return { created: createdIds.length };
  }

  async list(
    userId: string,
    options: { limit?: number } = {},
  ): Promise<NotificationListOutDto> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    const filter = { userId: new Types.ObjectId(userId) };

    const [rows, unreadCount] = await Promise.all([
      NotificationModel.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .exec(),
      NotificationModel.countDocuments({ ...filter, readAt: null }).exec(),
    ]);

    return {
      items: rows.map((row) => toOut(row as NotificationDoc)),
      unreadCount,
    };
  }

  async unreadCount(userId: string): Promise<NotificationUnreadCountOutDto> {
    const unreadCount = await NotificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
      readAt: null,
    }).exec();
    return { unreadCount };
  }

  async markRead(
    userId: string,
    id: string,
  ): Promise<NotificationMarkReadOutDto> {
    const now = new Date();
    const updated = await NotificationModel.findOneAndUpdate(
      {
        _id: id,
        userId: new Types.ObjectId(userId),
        readAt: null,
      },
      { $set: { readAt: now } },
      { returnDocument: "after" },
    )
      .lean()
      .exec();

    if (updated) {
      return { id: String(updated._id), readAt: now.toISOString() };
    }

    const existing = await NotificationModel.findOne({
      _id: id,
      userId: new Types.ObjectId(userId),
    })
      .lean()
      .exec();

    if (!existing) {
      throw new Error("Notification not found");
    }

    return {
      id: String(existing._id),
      readAt: existing.readAt
        ? existing.readAt.toISOString()
        : now.toISOString(),
    };
  }

  async markAllRead(userId: string): Promise<NotificationMarkAllReadOutDto> {
    const result = await NotificationModel.updateMany(
      { userId: new Types.ObjectId(userId), readAt: null },
      { $set: { readAt: new Date() } },
    ).exec();
    return { updated: result.modifiedCount };
  }
}

export const notificationService = new NotificationService();

/** In-app + email notification that never fails the caller; errors are logged. */
export async function safeNotify(input: {
  userIds: string[];
  title: string;
  body: string;
  link: string;
  html?: string | null;
}): Promise<void> {
  if (input.userIds.length === 0) return;
  try {
    await notificationService.notify({
      userIds: input.userIds,
      title: input.title,
      body: input.body,
      link: input.link,
      html: input.html,
      channels: ["in_app", "email"],
    });
  } catch (error) {
    logger.error(
      error instanceof Error ? error.message : String(error),
      "modules/notification/notification.service.ts",
      "safeNotify",
    );
  }
}
