import * as bcrypt from "bcrypt";
import type { Types } from "mongoose";
import { deleteFileIfExists, uploadFile } from "../../core/gridfs";
import type {
  ProfileOutDto,
  UpdateProfileInDto,
  UploadProfilePictureInDto,
  UploadProfilePictureOutDto,
} from "../../dto/profile.dto";
import { registerInDto, RegisterOutDto } from "../../dto/register.dto";
import { LoginInDto, LoginOutDto } from "../../dto/login.dto";
import {
  ResetPasswordInDto,
  ResetPasswordOutDto,
} from "../../dto/resetPassword.dto";
import { SendOtpInDto } from "../../dto/sendOtp.dto";
import { env } from "../../core/env";
import { logger } from "../../core/logger";
import { UserModel } from "../../models/user.model";
import { assertUploadFile } from "../../validation/uploadFile";
import { signAccessToken } from "../../utils/jwt";
import { appConfigService } from "../appConfig/AppConfig.service";
import { mailer } from "../mail/mail.service";
import { OtpService } from "../otp/otp.service";

const PROFILE_PICTURE_MAX_BYTES = 2 * 1024 * 1024;
const PROFILE_PICTURE_MIME = new Set(["image/png", "image/jpeg"]);

function profilePictureUrl(
  id: Types.ObjectId | null | undefined,
): string | null {
  return id ? `/media/${id.toString()}` : null;
}

function encodeResetToken(email: string, otp: string): string {
  return Buffer.from(JSON.stringify({ email, otp }), "utf8").toString(
    "base64url",
  );
}

function toProfileOut(user: {
  email?: string;
  fullName?: string;
  profilePicture?: Types.ObjectId | null;
}): ProfileOutDto {
  return {
    email: user.email ?? "",
    fullName: user.fullName?.trim() ?? "",
    profilePicture: profilePictureUrl(user.profilePicture),
  };
}

export class AuthService {
  private readonly source = "auth/auth.service.ts";

  async sendOtp(input: SendOtpInDto): Promise<boolean> {
    const email = input.email;
    const isResetPassword = input.isResetPassword ?? false;
    const otpService = new OtpService();
    const method = "sendOtp";

    const user = await UserModel.findOne({ email });
    if (isResetPassword) {
      if (!user) {
        throw new Error("No account found with this email");
      }
    } else if (user) {
      throw new Error("Email already registered");
    }

    const saved = await otpService.assignOtpWithMail(email);
    if (!saved) {
      logger.error(`Failed to save OTP for ${email}`, this.source, method);

      return false;
    }

    if (isResetPassword) {
      const token = encodeResetToken(email, otpService.otp);
      const resetUrl = `${env.frontendUrl}/reset-password?token=${token}`;
      const sent = await mailer.sendResetPasswordLink(email, resetUrl);

      if (!sent) {
        logger.error(
          `Failed to send reset password email to ${email}`,
          this.source,
          method,
        );

        return false;
      }
      logger.debug(`Reset password link sent to ${email}`, this.source, method);
      return true;
    }

    const sent = await mailer.sendOtp(email, otpService.otp);
    if (!sent) {
      logger.error(`Failed to send OTP email to ${email}`, this.source, method);
      return false;
    }

    logger.debug(`OTP sent successfully to ${email}`, this.source, method);
    return true;
  }

  async register(input: registerInDto): Promise<RegisterOutDto> {
    const email = input.email;
    const otp = input.otp;
    const password = input.password;
    const method = "register";
    const userExist = await UserModel.findOne({ email });

    if (userExist) {
      throw new Error("Email already registered");
    }

    if (!appConfigService.openRegister && !appConfigService.firstRegister) {
      throw new Error("Registration is closed, please contact admin");
    }

    const otpService = new OtpService();
    const ok = await otpService.validateAndConsume(email, otp);
    if (!ok) {
      throw new Error("Invalid or expired OTP");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const isFirstRegister = appConfigService.firstRegister;

    try {
      const user = await UserModel.create({
        email,
        hashedPassword,
        roles: isFirstRegister ? ["super_admin"] : [],
      });

      if (isFirstRegister) {
        appConfigService.markAdminRegistered();
      }

      const token = signAccessToken({
        userId: user.id,
        email: user.email!,
        rememberMe: false,
      });

      logger.debug(`User registered: ${email}`, this.source, method);

      return {
        email,
        jwt: token,
      };
    } catch (error) {
      logger.error(
        error instanceof Error ? error.message : String(error),
        this.source,
        method,
      );
      throw error;
    }
  }

  async login(input: LoginInDto): Promise<LoginOutDto> {
    const email = input.email;
    const password = input.password;
    const rememberMe = input.rememberMe ?? false;
    const method = "login";

    if (!appConfigService.openLogin) {
      throw new Error("Login is closed, please contact admin");
    }

    const user = await UserModel.findOne({ email });
    if (!user) {
      throw new Error("Invalid email or password");
    }

    const match = await bcrypt.compare(password, user.hashedPassword!);
    if (!match) {
      throw new Error("Invalid email or password");
    }

    const token = signAccessToken({
      userId: user.id,
      email: user.email!,
      rememberMe,
    });

    logger.debug(`User logged in: ${email}`, this.source, method);

    return {
      email: user.email!,
      jwt: token,
    };
  }

  async resetPassword(input: ResetPasswordInDto): Promise<ResetPasswordOutDto> {
    const email = input.email;
    const otp = input.otp;
    const password = input.password;
    const method = "resetPassword";

    const user = await UserModel.findOne({ email });
    if (!user) {
      throw new Error("No account found with this email");
    }

    const otpService = new OtpService();
    const ok = await otpService.validateAndConsume(email, otp);
    if (!ok) {
      throw new Error("Invalid or expired OTP");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await UserModel.updateOne({ email }, { hashedPassword });
    logger.debug(`Password reset for ${email}`, this.source, method);

    return { email };
  }

  async getProfile(userId: string): Promise<ProfileOutDto> {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }
    return toProfileOut(user);
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileInDto,
  ): Promise<ProfileOutDto> {
    const method = "updateProfile";
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    user.fullName = input.fullName;
    await user.save();
    logger.debug(`Profile updated for ${user.email}`, this.source, method);

    return toProfileOut(user);
  }

  async uploadProfilePicture(
    userId: string,
    input: UploadProfilePictureInDto,
  ): Promise<UploadProfilePictureOutDto> {
    const method = "uploadProfilePicture";

    assertUploadFile(
      {
        originalname: input.filename,
        mimetype: input.contentType,
        size: input.size,
      },
      PROFILE_PICTURE_MAX_BYTES,
    );

    if (!PROFILE_PICTURE_MIME.has(input.contentType)) {
      throw new Error("Profile picture must be a PNG or JPG");
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const oldId = user.profilePicture ?? null;

    const uploaded = await uploadFile("public", {
      buffer: input.buffer,
      filename: input.filename,
      contentType: input.contentType,
      metadata: { kind: "profilePicture", userId },
    });

    try {
      user.profilePicture = uploaded.id;
      await user.save();
    } catch (error) {
      await deleteFileIfExists("public", uploaded.id);
      throw error;
    }

    if (oldId) {
      await deleteFileIfExists("public", oldId);
    }

    logger.debug(
      `Profile picture updated for ${user.email}`,
      this.source,
      method,
    );

    return {
      id: uploaded.id.toString(),
      url: `/media/${uploaded.id.toString()}`,
    };
  }
}
