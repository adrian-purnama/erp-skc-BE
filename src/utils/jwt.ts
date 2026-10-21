import jwt from "jsonwebtoken";
import { env } from "../environment/env";

export type AccessTokenPayload = {
  userId: string;
  email: string;
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
    { expiresIn: payload.rememberMe ? "30d" : "1h" },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.jwtSecret);

  if (typeof decoded === "string" || !decoded || typeof decoded !== "object") {
    throw new Error("Invalid token");
  }

  const { userId, email } = decoded as AccessTokenPayload;

  if (!userId || !email) {
    throw new Error("Invalid token payload");
  }

  return { userId, email };
}
