import { Request, Response } from "express";
import { getUserPermissions } from "../../core/permissions/resolve.service";
import { fail, ok } from "../../dto/httpResponse";
import type { LoginInDto } from "../../dto/login.dto";
import { parseUpdateProfileDto } from "../../validation/profile";
import { parseSaveDashboardMetricsDto } from "../../validation/dashboardMetrics";
import {
  parseLoginDto,
  parseRegisterDto,
  parseResetPasswordDto,
  parseSendOtpDto,
} from "../../validation/auth";
import { AuthService } from "./auth.service";

export class AuthController {
  constructor(private readonly authService = new AuthService()) {}

  sendOtp = async (req: Request, res: Response) => {
    try {
      const input = parseSendOtpDto(req.body);
      const sent = await this.authService.sendOtp(input);

      if (!sent) {
        return fail(res, null, "Failed to send OTP", 500);
      }

      return ok(res, "OTP sent", { email: input.email });
    } catch (error) {
      return fail(res, error, "Failed to send OTP");
    }
  };

  register = async (req: Request, res: Response) => {
    try {
      const input = parseRegisterDto(req.body);
      const data = await this.authService.register(input);

      return ok(res, "Registered successfully", data, 201);
    } catch (error) {
      return fail(res, error, "Register failed");
    }
  };

  login = async (req: Request, res: Response) => {
    let input: LoginInDto;
    try {
      input = parseLoginDto(req.body);
    } catch (error) {
      return fail(res, error, "Login failed");
    }
    try {
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

  getDashboardMetrics = async (req: Request, res: Response) => {
    try {
      const data = await this.authService.getDashboardMetrics(String(req.user!._id));
      return ok(res, "Dashboard metrics loaded", data);
    } catch (error) {
      return fail(res, error, "Failed to load dashboard metrics");
    }
  };

  saveDashboardMetrics = async (req: Request, res: Response) => {
    try {
      const input = parseSaveDashboardMetricsDto(req.params.dashboard, req.body);
      const data = await this.authService.saveDashboardMetrics(
        String(req.user!._id),
        input,
      );
      return ok(res, "Dashboard metrics saved", data);
    } catch (error) {
      return fail(res, error, "Failed to save dashboard metrics");
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
      const input = parseResetPasswordDto(req.body);
      const data = await this.authService.resetPassword(input);

      return ok(res, "Password reset successfully", data);
    } catch (error) {
      return fail(res, error, "Password reset failed");
    }
  };
}
