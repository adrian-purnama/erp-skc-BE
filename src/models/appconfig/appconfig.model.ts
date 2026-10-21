import { model, Schema, Types } from "mongoose";

export interface AppConfigInterface {
    appName?: string;
    openLogin?: boolean;
    openRegister?: boolean;
    appLogo?: Types.ObjectId;
}

const appConfigSchema = new Schema<AppConfigInterface>({
    appName: {
        type: String,
        required: true,
    },

    openLogin: {
        type: Boolean,
        required: true,
    },

    openRegister: {
        type: Boolean,
        required: true,
    },

    appLogo: {
        type: Types.ObjectId,
        required: false,
    },
});

export const AppConfigModel = model<AppConfigInterface>("AppConfig", appConfigSchema)