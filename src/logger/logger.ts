import { styleText } from "node:util";
import { env } from "../environment/env";

function location(source?: string, method?: string): string {
  if (source && method) return `[${source}.${method}]`;
  if (source) return `[${source}]`;
  return "";
}

function format(
  level: string,
  color: Parameters<typeof styleText>[0],
  message: string,
  source?: string,
  method?: string,
): string {
  const loc = location(source, method);
  return `${styleText("gray", new Date().toISOString())} | ${styleText(color, `[${level}]`)} ${loc} ${message}`;
}

export const logger = {
  info(message: string, source?: string, method?: string): void {
    console.log(format("INFO", "blue", message, source, method));
  },
  error(message: string, source?: string, method?: string): void {
    console.error(format("ERROR", "red", message, source, method));
  },
  warn(message: string, source?: string, method?: string): void {
    console.warn(format("WARN", "yellow", message, source, method));
  },
  debug(message: string, source?: string, method?: string): void {
    if (env.build !== "development") return;
    console.debug(format("DEBUG", "cyan", message, source, method));
  },
};
