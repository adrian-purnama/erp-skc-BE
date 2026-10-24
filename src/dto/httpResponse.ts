import type { Response } from "express";
import type { ApiResponseDto } from "./apiResponse.dto";

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

export function fail(
  res: Response,
  error: unknown,
  fallback: string,
  status = 400,
) {
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
