import { model, Schema, Types } from "mongoose";

export interface Otpinterface {
    otp?: string;
    userId?: Types.ObjectId;
    email?: string;
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
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 300, // TTL: delete after 5 minutes
    },
});

export const OtpModel = model<Otpinterface>("Otp", otpSchema);
