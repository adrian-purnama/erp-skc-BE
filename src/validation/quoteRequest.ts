import type { QuoteRequestDto } from "../dto/landing.dto";
import { asRecord } from "./asRecord";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(raw: unknown, field: string, max: number, required = false): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (required && !value) throw new Error(`${field} is required`);
  if (value.length > max) throw new Error(`${field} must be ${max} characters or fewer`);
  return value;
}

/**
 * Website "Request a quote" form. `website` is a hidden honeypot field:
 * people never fill it, bots usually do.
 */
export function parseQuoteRequestDto(body: unknown): QuoteRequestDto {
  const row = asRecord(body);
  const email = text(row.email, "Email", 200, true);
  if (!EMAIL.test(email)) throw new Error("Enter a valid email address");
  return {
    name: text(row.name, "Name", 120, true),
    email,
    company: text(row.company, "Company", 160),
    phone: text(row.phone, "Phone", 40),
    service: text(row.service, "Service", 120),
    location: text(row.location, "Project location", 160),
    message: text(row.message, "Message", 5000),
    isBot: typeof row.website === "string" && row.website.trim() !== "",
  };
}
