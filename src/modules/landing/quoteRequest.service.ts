import { logger } from "../../core/logger";
import type { QuoteRequestDto } from "../../dto/landing.dto";
import { appConfigService } from "../appConfig";
import { mailer } from "../mail";

const logSource = "modules/landing/quoteRequest.service.ts";

/** Email a website quote request to the company email set in Admin › Config. */
export async function sendQuoteRequest(input: QuoteRequestDto): Promise<void> {
  if (input.isBot) {
    logger.info("Quote request dropped by honeypot", logSource, "sendQuoteRequest");
    return;
  }
  const to = appConfigService.getAppConfig().email.trim();
  if (!to) {
    logger.error("Company email is empty in Admin > Config", logSource, "sendQuoteRequest");
    throw new Error("We could not send your request right now. Please email us directly.");
  }
  const { isBot: _isBot, ...fields } = input;
  const sent = await mailer.sendQuoteRequest(to, fields);
  if (!sent) {
    throw new Error("We could not send your request right now. Please try again later.");
  }
}
