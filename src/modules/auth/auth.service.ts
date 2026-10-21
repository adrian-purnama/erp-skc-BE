import * as bcrypt from "bcrypt";
import { registerInDto, RegisterOutDto } from "../../dto/register.dto";
import { LoginInDto, LoginOutDto } from "../../dto/login.dto";
import {
  ResetPasswordInDto,
  ResetPasswordOutDto,
} from "../../dto/resetPassword.dto";
import { SendOtpInDto } from "../../dto/sendOtp.dto";
import { env } from "../../environment/env";
import { logger } from "../../logger/logger";
import { UserModel } from "../../models/user/user.model";
import { signAccessToken } from "../../utils/jwt";
import { encodeResetToken } from "../../utils/resetToken";
import { appConfigService } from "../appConfig/AppConfig.service";
import { mailer } from "../mail/mail.service";
import { OtpService } from "../otp/otp.service";

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
}
