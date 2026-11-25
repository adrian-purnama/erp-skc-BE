import { randomInt } from "node:crypto";
import { logger } from "../../core/logger";
import { OtpModel } from "../../models/otp.model";

/** Wrong guesses allowed per OTP before it is deleted. */
export const OTP_MAX_ATTEMPTS = 5;

export class OtpService {
    otp: string;

    constructor() {
        this.otp = this.generateOtp();
    }

    generateOtp(): string {
        return randomInt(100000, 1000000).toString();
    }

    async assignOtpWithMail(email: string): Promise<boolean> {
        await OtpModel.deleteMany({ email });

        const success = await OtpModel.create({
            email,
            otp: this.otp,
        });

        if (!success) {
            logger.error(
                `error saving otp for ${email}`,
                "otp/otp.service.ts",
                "assignOtpWithMail"
            );
            return false;
        }

        return true;
    }

    /**
     * Consume the OTP on a match. A wrong guess counts against the live OTP;
     * after `OTP_MAX_ATTEMPTS` misses it is deleted and a new one must be sent.
     */
    async validateAndConsume(email: string, otp: string): Promise<boolean> {
        const found = await OtpModel.findOneAndDelete({
            email,
            otp,
            attempts: { $lt: OTP_MAX_ATTEMPTS },
        });
        if (found) return true;

        const missed = await OtpModel.findOneAndUpdate(
            { email },
            { $inc: { attempts: 1 } },
            { returnDocument: "after" },
        );
        if (missed && (missed.attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
            await OtpModel.deleteMany({ email });
        }

        logger.warn(
            `Invalid or expired OTP for ${email}`,
            "otp/otp.service.ts",
            "validateAndConsume"
        );
        return false;
    }
}
