import { model, Schema, type Types } from "mongoose";

export const EMAIL_TYPES = ["work", "home", "campus", "other"] as const;
export type EmailType = (typeof EMAIL_TYPES)[number];

export interface EmailInterface {
  ownerId: Types.ObjectId;
  address: string;
  type: EmailType;
  isPreferred: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const emailSchema = new Schema<EmailInterface>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: EMAIL_TYPES,
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

emailSchema.index({ ownerId: 1, isPreferred: 1 });

export const EmailModel = model<EmailInterface>("Email", emailSchema);
