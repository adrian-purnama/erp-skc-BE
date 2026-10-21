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
