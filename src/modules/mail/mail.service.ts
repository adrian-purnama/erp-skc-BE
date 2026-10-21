import { BrevoClient } from "@getbrevo/brevo";
import { env } from "../../environment/env";
import { logger } from "../../logger/logger";

const sans =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

function layout(title: string, heading: string, innerHtml: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:Georgia,'Times New Roman',serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f0f2f5;padding:40px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f766e 0%,#134e4a 100%);padding:28px 32px;">
            <p style="margin:0;font-family:${sans};font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.75);">SapAi</p>
            <h1 style="margin:8px 0 0;font-family:${sans};font-size:22px;font-weight:600;color:#ffffff;line-height:1.3;">${heading}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 32px 28px;">
            ${innerHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 28px;">
            <div style="height:1px;background-color:#e2e8f0;margin-bottom:20px;"></div>
            <p style="margin:0;font-family:${sans};font-size:12px;color:#94a3b8;text-align:center;">
              © ${new Date().getFullYear()} SapAi
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
}

class MailService {
  private readonly client = new BrevoClient({ apiKey: env.brevoApiKey });
  private readonly senderEmail = env.brevoSenderEmail;
  private readonly source = "modules/mail/mail.service.ts";

  async sendOtp(to: string, otp: string): Promise<boolean> {
    try {
      await this.client.transactionalEmails.sendTransacEmail({
        subject: "Your verification code",
        sender: { name: "SapAi", email: this.senderEmail },
        to: [{ email: to }],
        htmlContent: layout(
          "Verification code",
          "Verify your email",
          `
            <p style="margin:0 0 8px;font-family:${sans};font-size:15px;line-height:1.6;color:#334155;">
              Use this one-time code to finish signing up. It expires shortly   don’t share it with anyone.
            </p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:28px 0;">
              <tr>
                <td align="center" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:22px 16px;">
                  <p style="margin:0 0 6px;font-family:${sans};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;">Your code</p>
                  <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:36px;font-weight:700;letter-spacing:0.28em;color:#0f766e;">
                    ${otp}
                  </p>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-family:${sans};font-size:13px;line-height:1.5;color:#94a3b8;">
              If you didn’t request this, you can ignore this email.
            </p>
          `,
        ),
      });

      logger.debug(`OTP email sent to ${to}`, this.source, "sendOtp");
      return true;
    } catch (error) {
      logger.error(
        error instanceof Error ? error.message : String(error),
        this.source,
        "sendOtp",
      );
      return false;
    }
  }

  async sendResetPasswordLink(to: string, resetUrl: string): Promise<boolean> {
    try {
      await this.client.transactionalEmails.sendTransacEmail({
        subject: "Reset your password",
        headers: {
          "X-Mailin-Track": "false",
          "X-Mailin-Track-Clicks": "false",
        },
        sender: { name: "SapAi", email: this.senderEmail },
        to: [{ email: to }],
        htmlContent: layout(
          "Reset your password",
          "Reset your password",
          `
            <p style="margin:0 0 24px;font-family:${sans};font-size:15px;line-height:1.6;color:#334155;">
              Click the button below to choose a new password. This link expires shortly.
            </p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr>
                <td align="center">
                  <a href="${resetUrl}" style="display:inline-block;background-color:#0f766e;color:#ffffff;font-family:${sans};font-size:15px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:8px;">
                    Reset password
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;font-family:${sans};font-size:13px;line-height:1.5;color:#94a3b8;word-break:break-all;">
              Or copy and paste this link into your browser:<br />
              <a href="${resetUrl}" style="color:#0f766e;">${resetUrl}</a>
            </p>
            <p style="margin:24px 0 0;font-family:${sans};font-size:13px;line-height:1.5;color:#94a3b8;">
              If you didn't request this, you can ignore this email.
            </p>
          `,
        ),
      });

      logger.debug(
        `Reset password email sent to ${to} - ${resetUrl}`,
        this.source,
        "sendResetPasswordLink",
      );
      return true;
    } catch (error) {
      logger.error(
        error instanceof Error ? error.message : String(error),
        this.source,
        "sendResetPasswordLink",
      );
      return false;
    }
  }
}

export const mailer = new MailService();
