import { model, Schema, type Types } from "mongoose";

export const PHONE_TYPES = ["home", "personal", "whatsapp"] as const;
export type PhoneType = (typeof PHONE_TYPES)[number];

export interface PhoneInterface {
  ownerId: Types.ObjectId;
  number: string;
  type: PhoneType;
  isPreferred: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const phoneSchema = new Schema<PhoneInterface>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    number: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: PHONE_TYPES,
      required: true,
    },
    isPreferred: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  { timestamps: true },
);

phoneSchema.index({ ownerId: 1, isPreferred: 1 });

export const PhoneModel = model<PhoneInterface>("Phone", phoneSchema);
