import { BrevoClient } from "@getbrevo/brevo";
import { env } from "../../core/env";
import { logger } from "../../core/logger";
import { appConfigService } from "../appConfig/AppConfig.service";

const sans =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const brand = {
  primary: "#0f766e",
  primaryDark: "#134e4a",
  text: "#0f172a",
  body: "#334155",
  muted: "#64748b",
  faint: "#94a3b8",
  border: "#e2e8f0",
  surface: "#f8fafc",
  page: "#f1f5f9",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

type Branding = {
  appName: string;
  logoUrl: string | null;
  companyName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
};

/** Live branding from AppConfig; the logo needs a publicly reachable API URL. */
function branding(): Branding {
  const config = appConfigService.getAppConfig();
  const appName = config.appName.trim() || "Enterprise Resource Management";
  const logoUrl =
    config.appLogo && env.publicApiUrl
      ? `${trimSlash(env.publicApiUrl)}${config.appLogo}`
      : null;
  return {
    appName,
    logoUrl,
    companyName: config.companyName.trim(),
    address: config.address.trim(),
    phone: config.phone.trim(),
    email: config.email.trim(),
    website: config.website.trim(),
  };
}

function absoluteAppLink(link: string): string {
  if (/^https?:\/\//i.test(link)) return link;
  return `${trimSlash(env.frontendUrl)}${link.startsWith("/") ? link : `/${link}`}`;
}

function brandMark(b: Branding): string {
  const name = escapeHtml(b.appName);
  const mark = b.logoUrl
    ? `<img src="${escapeHtml(b.logoUrl)}" alt="${name}" height="40" style="display:block;height:40px;width:auto;max-width:160px;border:0;outline:none;text-decoration:none;" />`
    : `<table role="presentation" cellspacing="0" cellpadding="0"><tr><td align="center" valign="middle" width="40" height="40" bgcolor="${brand.primary}" style="width:40px;height:40px;border-radius:10px;background-color:${brand.primary};font-family:${sans};font-size:18px;font-weight:700;color:#ffffff;">${escapeHtml(b.appName.charAt(0).toUpperCase())}</td></tr></table>`;
  return `
    <table role="presentation" cellspacing="0" cellpadding="0">
      <tr>
        <td valign="middle" style="padding-right:12px;">${mark}</td>
        <td valign="middle" style="font-family:${sans};font-size:17px;font-weight:700;color:${brand.text};">${name}</td>
      </tr>
    </table>`;
}

function footer(b: Branding): string {
  const org = escapeHtml(b.companyName || b.appName);
  const contact = [b.phone, b.email, b.website]
    .filter(Boolean)
    .map((v) => escapeHtml(v))
    .join(" &nbsp;·&nbsp; ");
  return `
    <p style="margin:0 0 6px;font-family:${sans};font-size:13px;font-weight:600;color:${brand.muted};">${org}</p>
    ${b.address ? `<p style="margin:0 0 6px;font-family:${sans};font-size:12px;line-height:1.5;color:${brand.faint};">${escapeHtml(b.address)}</p>` : ""}
    ${contact ? `<p style="margin:0 0 6px;font-family:${sans};font-size:12px;line-height:1.5;color:${brand.faint};">${contact}</p>` : ""}
    <p style="margin:12px 0 0;font-family:${sans};font-size:11px;line-height:1.5;color:${brand.faint};">
      This is an automated message from ${escapeHtml(b.appName)}. Please do not reply to this email.<br />
      &copy; ${new Date().getFullYear()} ${org}. All rights reserved.
    </p>`;
}

function button(href: string, label: string): string {
  const url = escapeHtml(href);
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 0;">
      <tr>
        <td align="center" bgcolor="${brand.primary}" style="border-radius:8px;background-color:${brand.primary};">
          <a href="${url}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:${sans};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>
    <p style="margin:20px 0 0;font-family:${sans};font-size:12px;line-height:1.5;color:${brand.faint};word-break:break-all;">
      Button not working? Copy and paste this link into your browser:<br />
      <a href="${url}" target="_blank" style="color:${brand.primary};text-decoration:underline;">${url}</a>
    </p>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-family:${sans};font-size:15px;line-height:1.65;color:${brand.body};">${text}</p>`;
}

function note(text: string): string {
  return `<p style="margin:24px 0 0;font-family:${sans};font-size:13px;line-height:1.55;color:${brand.muted};">${text}</p>`;
}

/**
 * Branded email shell. `heading` and `preheader` are plain text (escaped here);
 * `innerHtml` is trusted markup built by the caller.
 */
function layout(
  heading: string,
  innerHtml: string,
  options: { preheader?: string; eyebrow?: string } = {},
): string {
  const b = branding();
  const title = escapeHtml(`${heading} · ${b.appName}`);
  const preheader = escapeHtml(options.preheader ?? heading);
  const eyebrow = options.eyebrow
    ? `<p style="margin:0 0 8px;font-family:${sans};font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${brand.primary};">${escapeHtml(options.eyebrow)}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light" />
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:${brand.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${preheader}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${brand.page}" style="background-color:${brand.page};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
        <tr>
          <td style="padding:0 4px 20px;">${brandMark(b)}</td>
        </tr>
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid ${brand.border};border-radius:12px;overflow:hidden;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr>
                <td height="4" bgcolor="${brand.primary}" style="height:4px;line-height:4px;font-size:0;background-color:${brand.primary};">&nbsp;</td>
              </tr>
              <tr>
                <td style="padding:32px 32px 8px;">
                  ${eyebrow}
                  <h1 style="margin:0 0 20px;font-family:${sans};font-size:22px;font-weight:700;line-height:1.3;color:${brand.text};">${escapeHtml(heading)}</h1>
                  ${innerHtml}
                </td>
              </tr>
              <tr>
                <td style="padding:24px 32px 0;">&nbsp;</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:24px 16px 0;text-align:center;">${footer(b)}</td>
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

  private sender(): { name: string; email: string } {
    return { name: branding().appName, email: this.senderEmail };
  }

  async sendOtp(to: string, otp: string): Promise<boolean> {
    const appName = escapeHtml(branding().appName);
    try {
      await this.client.transactionalEmails.sendTransacEmail({
        subject: `${otp} is your ${branding().appName} verification code`,
        sender: this.sender(),
        to: [{ email: to }],
        htmlContent: layout(
          "Verify your email",
          `
            ${paragraph(`Use the one-time code below to continue with ${appName}. It expires shortly, so enter it soon.`)}
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 8px;">
              <tr>
                <td align="center" bgcolor="${brand.surface}" style="background-color:${brand.surface};border:1px dashed ${brand.border};border-radius:10px;padding:22px 16px;">
                  <p style="margin:0 0 6px;font-family:${sans};font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${brand.muted};">Verification code</p>
                  <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:0.3em;color:${brand.primaryDark};">${escapeHtml(otp)}</p>
                </td>
              </tr>
            </table>
            ${note(`For your security, never share this code with anyone, including ${appName} staff. If you didn't request it, you can safely ignore this email.`)}
          `,
          {
            preheader: `Your verification code is ${otp}`,
            eyebrow: "Account security",
          },
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

  async sendNotification(
    to: string,
    input: {
      title: string;
      body: string;
      link?: string | null;
      html?: string | null;
    },
  ): Promise<boolean> {
    const title = input.title.trim();
    const body = input.body.trim();
    const customHtml = input.html?.trim() || null;
    const link = input.link?.trim() || null;
    const absoluteLink = link ? absoluteAppLink(link) : null;

    const bodyBlock = customHtml
      ? `<div style="margin:0 0 16px;font-family:${sans};font-size:15px;line-height:1.65;color:${brand.body};">${customHtml}</div>`
      : paragraph(escapeHtml(body).replace(/\r?\n/g, "<br />"));

    const ctaBlock = absoluteLink ? button(absoluteLink, "View in app") : "";

    try {
      await this.client.transactionalEmails.sendTransacEmail({
        subject: title,
        sender: this.sender(),
        to: [{ email: to }],
        htmlContent: layout(title, `${bodyBlock}${ctaBlock}`, {
          preheader: body.slice(0, 140) || title,
          eyebrow: "Notification",
        }),
      });

      logger.debug(
        `Notification email sent to ${to}`,
        this.source,
        "sendNotification",
      );
      return true;
    } catch (error) {
      logger.error(
        error instanceof Error ? error.message : String(error),
        this.source,
        "sendNotification",
      );
      return false;
    }
  }

  async sendResetPasswordLink(to: string, resetUrl: string): Promise<boolean> {
    const appName = escapeHtml(branding().appName);
    try {
      await this.client.transactionalEmails.sendTransacEmail({
        subject: `Reset your ${branding().appName} password`,
        headers: {
          "X-Mailin-Track": "false",
          "X-Mailin-Track-Clicks": "false",
        },
        sender: this.sender(),
        to: [{ email: to }],
        htmlContent: layout(
          "Reset your password",
          `
            ${paragraph(`We received a request to reset the password for your ${appName} account. Click the button below to choose a new one. This link expires shortly.`)}
            ${button(resetUrl, "Reset password")}
            ${note("If you didn't request a password reset, you can safely ignore this email. Your password won't change.")}
          `,
          {
            preheader: `Reset the password for your ${branding().appName} account`,
            eyebrow: "Account security",
          },
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
