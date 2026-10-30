import { Request, Response } from "express";
import { getUserPermissions } from "../../core/permissions/resolve.service";
import { fail, ok } from "../../dto/httpResponse";
import { LoginInDto } from "../../dto/login.dto";
import { registerInDto } from "../../dto/register.dto";
import { normalizeEmail } from "../../utils/email";
import { parseUpdateProfileDto } from "../../validation/profile";
import { AuthService } from "./auth.service";

export class AuthController {
  constructor(private readonly authService = new AuthService()) {}

  sendOtp = async (req: Request, res: Response) => {
    try {
      const email = normalizeEmail(req.body?.email);

      if (!email) {
        return fail(res, null, "Invalid email");
      }

      const isResetPassword = Boolean(req.body?.isResetPassword);

      const sent = await this.authService.sendOtp({ email, isResetPassword });

      if (!sent) {
        return fail(res, null, "Failed to send OTP", 500);
      }

      return ok(res, "OTP sent", { email });
    } catch (error) {
      return fail(res, error, "Failed to send OTP");
    }
  };

  register = async (req: Request, res: Response) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
      const password =
        typeof req.body?.password === "string" ? req.body.password : "";

      if (!email) {
        return fail(res, null, "Invalid email");
      }

      if (!otp || !password) {
        return fail(res, null, "OTP and password are required");
      }

      const input: registerInDto = { email, otp, password };
      const data = await this.authService.register(input);

      return ok(res, "Registered successfully", data, 201);
    } catch (error) {
      return fail(res, error, "Register failed");
    }
  };

  login = async (req: Request, res: Response) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password =
        typeof req.body?.password === "string" ? req.body.password : "";
      const rememberMe = Boolean(req.body?.rememberMe);

      if (!email) {
        return fail(res, null, "Invalid email");
      }

      if (!password) {
        return fail(res, null, "Password is required");
      }

      const input: LoginInDto = { email, password, rememberMe };
      const data = await this.authService.login(input);

      return ok(res, "Logged in successfully", data);
    } catch (error) {
      return fail(res, error, "Login failed", 401);
    }
  };

  validateUser = async (req: Request, res: Response) => {
    const permissions = await getUserPermissions(req.user!);
    const pictureId = req.user!.profilePicture;
    return ok(res, "Token is valid", {
      email: req.user!.email!,
      fullName: req.user!.fullName?.trim() ?? "",
      profilePicture: pictureId ? `/media/${pictureId.toString()}` : null,
      roles: req.user!.roles ?? [],
      permissions: [...permissions],
    });
  };

  getProfile = async (req: Request, res: Response) => {
    try {
      const data = await this.authService.getProfile(String(req.user!._id));
      return ok(res, "Profile loaded", data);
    } catch (error) {
      return fail(res, error, "Failed to load profile");
    }
  };

  updateProfile = async (req: Request, res: Response) => {
    try {
      const input = parseUpdateProfileDto(req.body);
      const data = await this.authService.updateProfile(
        String(req.user!._id),
        input,
      );
      return ok(res, "Profile updated", data);
    } catch (error) {
      return fail(res, error, "Failed to update profile");
    }
  };

  uploadProfilePicture = async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return fail(res, null, "file required");
      }

      const data = await this.authService.uploadProfilePicture(
        String(req.user!._id),
        {
          buffer: req.file.buffer,
          filename: req.file.originalname,
          contentType: req.file.mimetype,
          size: req.file.size,
        },
      );
      return ok(res, "Profile picture updated", data);
    } catch (error) {
      return fail(res, error, "Failed to update profile picture");
    }
  };

  resetPassword = async (req: Request, res: Response) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
      const password =
        typeof req.body?.password === "string" ? req.body.password : "";

      if (!email) {
        return fail(res, null, "Invalid email");
      }

      if (!otp || !password) {
        return fail(res, null, "OTP and password are required");
      }

      const data = await this.authService.resetPassword({
        email,
        otp,
        password,
      });

      return ok(res, "Password reset successfully", data);
    } catch (error) {
      return fail(res, error, "Password reset failed");
    }
  };
}
