import { model, Schema, Types } from "mongoose";

export interface Otpinterface {
    otp?: string;
    userId?: Types.ObjectId;
    email?: string;
    /** Wrong guesses so far; the OTP is burned at `OTP_MAX_ATTEMPTS`. */
    attempts?: number;
    createdAt?: Date;
}

const otpSchema = new Schema<Otpinterface>({
    otp: {
        type: String,
        required: true,
    },
    userId: {
        type: Types.ObjectId,
        ref: "User",
    },
    email: {
        type: String,
        index: true,
    },
    attempts: {
        type: Number,
        default: 0,
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 300, // TTL: delete after 5 minutes
    },
});

export const OtpModel = model<Otpinterface>("Otp", otpSchema);
