import { model, Schema, Types } from "mongoose";

export interface AppConfigInterface {
    appName?: string;
    description?: string;
    openLogin?: boolean;
    openRegister?: boolean;
    appLogo?: Types.ObjectId;
    companyName?: string;
    npwp?: string;
    address?: string;
    branchOfficeAddresses?: string[];
    phone?: string;
    email?: string;
    website?: string;
    companyProfile?: Types.ObjectId;
}

const optionalString = {
    type: String,
    required: false,
    trim: true,
} as const;

const appConfigSchema = new Schema<AppConfigInterface>({
    appName: {
        type: String,
        required: true,
    },

    description: optionalString,

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

    companyName: optionalString,
    npwp: optionalString,
    address: optionalString,
    branchOfficeAddresses: {
        type: [String],
        required: false,
        default: () => [],
    },
    phone: optionalString,
    email: optionalString,
    website: optionalString,

    companyProfile: {
        type: Types.ObjectId,
        required: false,
    },
});

export const AppConfigModel = model<AppConfigInterface>("AppConfig", appConfigSchema);
