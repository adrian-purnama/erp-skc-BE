export interface NotificationOutDto {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListOutDto {
  items: NotificationOutDto[];
  unreadCount: number;
}

export interface NotificationUnreadCountOutDto {
  unreadCount: number;
}

export interface NotificationMarkReadOutDto {
  id: string;
  readAt: string;
}

export interface NotificationMarkAllReadOutDto {
  updated: number;
}

export type NotificationChannel = "in_app" | "email";

export interface NotifyInDto {
  userIds: string[];
  title: string;
  /** Plain text for the in-app inbox (and email fallback when `html` is omitted). */
  body: string;
  link?: string | null;
  /**
   * Optional HTML fragment for the email only (timeline, tables, etc.).
   * Inserted inside the branded email layout; not stored on the inbox row.
   */
  html?: string | null;
  channels?: NotificationChannel[];
}
