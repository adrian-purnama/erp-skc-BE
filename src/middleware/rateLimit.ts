import type { Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import type { ApiResponseDto } from "../dto/httpResponse";

const WINDOW_MS = 15 * 60 * 1000;

function tooManyRequests(_req: Request, res: Response): void {
  res.status(429).json({
    success: false,
    message: "Too many attempts, please try again later",
    data: null,
  } satisfies ApiResponseDto);
}

/** OTP / reset-link emails: each one costs a send and can be used to spam. Per IP. */
export const otpSendRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: tooManyRequests,
});

/** Login / register / reset: password and OTP guessing. Per IP. */
export const authAttemptRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: tooManyRequests,
});
