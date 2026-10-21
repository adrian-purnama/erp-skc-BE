import { model, Schema } from "mongoose";

export interface UserInterface {
  email?: string;
  hashedPassword?: string;
  isBlocked?: boolean;
  roles?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

const userSchema = new Schema<UserInterface>(
  {
    email: {
      type: String,
      required: true,
    },
    hashedPassword: {
      type: String,
      required: true,
    },
    isBlocked: {
      type: Boolean,
      required: true,
      default: false,
    },
    roles: {
      type: [String],
      required: true,
      default: [],
    },
  },
  { timestamps: true },
);

export const UserModel = model<UserInterface>("User", userSchema);
