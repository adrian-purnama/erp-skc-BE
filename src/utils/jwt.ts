import jwt from "jsonwebtoken";
import { env } from "../core/env";

export type AccessTokenPayload = {
  userId: string;
  email: string;
  /** JWT `iat`, in seconds. */
  issuedAt: number;
};

export function signAccessToken(payload: {
  userId: string;
  email: string;
  rememberMe: boolean;
}): string {
  return jwt.sign(
    {
      userId: payload.userId,
      email: payload.email,
    },
    env.jwtSecret,
    {
      expiresIn: payload.rememberMe ? env.sessionTtlRememberMe : env.sessionTtl,
    },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.jwtSecret);

  if (typeof decoded === "string" || !decoded || typeof decoded !== "object") {
    throw new Error("Invalid token");
  }

  const { userId, email, iat } = decoded as {
    userId?: string;
    email?: string;
    iat?: number;
  };

  if (!userId || !email || typeof iat !== "number") {
    throw new Error("Invalid token payload");
  }

  return { userId, email, issuedAt: iat };
}

/**
 * A token issued before the user's last password change is revoked.
 * `iat` has 1-second resolution, so compare in whole seconds.
 */
export function isTokenRevoked(
  issuedAt: number,
  passwordChangedAt: Date | null | undefined,
): boolean {
  if (!passwordChangedAt) return false;
  return issuedAt < Math.floor(passwordChangedAt.getTime() / 1000);
}
