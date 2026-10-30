import { mailer } from "../mail/mail.service";

export type SendNotificationEmailInput = {
  title: string;
  /** Plain-text fallback when `html` is omitted. */
  body: string;
  link?: string | null;
  /**
   * Optional HTML fragment placed inside the branded email layout.
   * Callers own escaping of any untrusted text inside this fragment.
   */
  html?: string | null;
};

/**
 * Outbound mail facade. Swap the provider here without touching notification callers.
 */
class EmailService {
  sendNotification(
    to: string,
    input: SendNotificationEmailInput,
  ): Promise<boolean> {
    return mailer.sendNotification(to, input);
  }
}

export const emailService = new EmailService();
