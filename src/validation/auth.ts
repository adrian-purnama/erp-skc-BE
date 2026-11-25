import type { LoginInDto } from "../dto/login.dto";
import type { registerInDto } from "../dto/register.dto";
import type { ResetPasswordInDto } from "../dto/resetPassword.dto";
import type { SendOtpInDto } from "../dto/sendOtp.dto";
import { normalizeEmail } from "../utils/email";
import { asRecord } from "./asRecord";

export const MIN_PASSWORD_LENGTH = 8;

function parseEmail(raw: Record<string, unknown>): string {
  const email = normalizeEmail(raw.email);
  if (!email) throw new Error("Invalid email");
  return email;
}

function parseOtp(raw: Record<string, unknown>): string {
  const otp = typeof raw.otp === "string" ? raw.otp.trim() : "";
  if (!otp) throw new Error("OTP is required");
  return otp;
}

/** Validates a password being set (register / reset / admin). */
export function parseNewPassword(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new Error("Password is required");
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
  return value;
}

export function parseSendOtpDto(body: unknown): SendOtpInDto {
  const raw = asRecord(body);
  return {
    email: parseEmail(raw),
    isResetPassword: raw.isResetPassword === true,
  };
}

export function parseRegisterDto(body: unknown): registerInDto {
  const raw = asRecord(body);
  return {
    email: parseEmail(raw),
    otp: parseOtp(raw),
    password: parseNewPassword(raw.password),
  };
}

export function parseLoginDto(body: unknown): LoginInDto {
  const raw = asRecord(body);
  const email = parseEmail(raw);
  const password = typeof raw.password === "string" ? raw.password : "";
  if (!password) throw new Error("Password is required");
  return { email, password, rememberMe: raw.rememberMe === true };
}

export function parseResetPasswordDto(body: unknown): ResetPasswordInDto {
  const raw = asRecord(body);
  return {
    email: parseEmail(raw),
    otp: parseOtp(raw),
    password: parseNewPassword(raw.password),
  };
}
