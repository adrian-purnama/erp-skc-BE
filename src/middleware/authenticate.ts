import { HydratedDocument } from "mongoose";
import { UserInterface, UserModel } from "../models/user.model";
import { verifyAccessToken } from "../utils/jwt";

export class AuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: 401 | 403 = 401,
  ) {
    super(message);
  }
}

export async function authenticateByToken(
  token: string,
): Promise<HydratedDocument<UserInterface>> {
  if (!token) {
    throw new AuthError("Missing or invalid authorization token");
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await UserModel.findById(payload.userId);

    if (!user) {
      throw new AuthError("User not found");
    }

    if (user.isBlocked) {
      throw new AuthError("User is blocked", 403);
    }

    return user;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    throw new AuthError("Invalid token");
  }
}
