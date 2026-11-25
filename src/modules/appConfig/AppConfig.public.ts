import { findFile, readFileBuffer } from "../../core/gridfs";
import { logger } from "../../core/logger";
import type { DocumentLogo } from "../../utils/document/logo";
import { splitLines } from "../../utils/document/text";
import { appConfigService } from "./AppConfig.service";

/** Company identity for printed documents (Admin › Config), for other modules. */

/** Company profile logo from Admin › Config (live, not a snapshot). */
export async function loadCompanyLogo(): Promise<DocumentLogo | null> {
  const id = appConfigService.companyProfile;
  if (!id) return null;
  try {
    const file = await findFile("public", id);
    if (!file) return null;
    const contentType =
      typeof file.metadata?.contentType === "string"
        ? file.metadata.contentType
        : "application/octet-stream";
    return { buffer: await readFileBuffer("public", id), contentType };
  } catch (error) {
    logger.warn(
      error instanceof Error ? error.message : String(error),
      "modules/appConfig/AppConfig.public.ts",
      "loadCompanyLogo",
    );
    return null;
  }
}

/** Company name and address lines for printed documents (Admin › Config). */
export function companyLetterhead(): { companyName: string; letterhead: string[] } {
  const config = appConfigService.getAppConfig();
  const branches = (config.branchOfficeAddresses ?? [])
    .map(splitLines)
    .filter((lines) => lines.length > 0);
  const labelled = (label: string, lines: string[]) =>
    lines.map((l, i) => (i === 0 ? `${label}: ${l}` : l));
  const letterhead = [
    ...(branches.length > 0
      ? [
          ...labelled("Head Office", splitLines(config.address)),
          ...branches.flatMap((lines) => labelled("Branch Office", lines)),
        ]
      : splitLines(config.address)),
    [config.phone && `Telp: ${config.phone}`, config.email].filter(Boolean).join(" · "),
    config.website,
  ].filter((line): line is string => Boolean(line));
  return { companyName: config.companyName, letterhead };
}
