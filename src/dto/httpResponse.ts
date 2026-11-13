import type { Response } from "express";
import { logger } from "../core/logger";

export interface ApiResponseDto<T = null> {
  success: boolean;
  message: string;
  data: T;
}

export function ok<T>(
  res: Response,
  message: string,
  data: T,
  status = 200,
) {
  return res.status(status).json({
    success: true,
    message,
    data,
  } satisfies ApiResponseDto<T>);
}

/** Driver / runtime errors: their message is for the log, not for the user. */
const TECHNICAL_ERRORS = new Set([
  "BSONError",
  "CastError",
  "MongoError",
  "MongoServerError",
  "MongooseError",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
]);

export function fail(
  res: Response,
  error: unknown,
  fallback: string,
  status = 400,
) {
  if (error instanceof Error && TECHNICAL_ERRORS.has(error.name)) {
    logger.error(`${fallback}: ${error.stack ?? error.message}`, "httpResponse", "fail");
    return res.status(500).json({
      success: false,
      message: fallback,
      data: null,
    } satisfies ApiResponseDto);
  }
  return res.status(status).json({
    success: false,
    message: error instanceof Error ? error.message : fallback,
    data: null,
  } satisfies ApiResponseDto);
}

/** Run a controller action and map its result/error to the API envelope. */
export function handle<T>(
  res: Response,
  fallback: string,
  message: string | ((data: T) => string),
  fn: () => Promise<T>,
  status = 200,
): Promise<Response> {
  return Promise.resolve()
    .then(fn)
    .then(
      (data) =>
        ok(
          res,
          typeof message === "function" ? message(data) : message,
          data,
          status,
        ),
      (error) => fail(res, error, fallback),
    );
}
