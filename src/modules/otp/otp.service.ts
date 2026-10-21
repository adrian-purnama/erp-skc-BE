import { logger } from "../../logger/logger";
import { OtpModel } from "../../models/otp/otp.model";

export class OtpService {
    otp: string;

    constructor() {
        this.otp = this.generateOtp();
    }

    generateOtp(): string {
        return Math.floor(100000 + Math.random() * 900000).toString();
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


    async validateAndConsume(email:string, otp:string):Promise<boolean>{
        const found = await OtpModel.findOneAndDelete({ email, otp });

        if(!found){
            logger.error(
                `Invalid or expired OTP for ${email}`,
                "otp/otp.service.ts",
                "validateAndConsume"
            )
            return false
        }

        return true
    }


}
