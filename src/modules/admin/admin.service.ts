import * as bcrypt from "bcrypt";
import { Types } from "mongoose";
import type {
  AdminUserDetailOutDto,
  AdminUserOutDto,
  UpdateAdminUserDto,
} from "../../dto/adminUser.dto";
import { UserModel } from "../../models/user/user.model";
import { escapeRegex } from "../../utils/shared";
function toAdminUser(doc: {
  id: string;
  email?: string;
  isBlocked?: boolean;
  roles?: string[];
}): AdminUserOutDto {
  return {
    id: doc.id,
    email: doc.email ?? "",
    isBlocked: Boolean(doc.isBlocked),
    roles: doc.roles ?? [],
  };
}

export class AdminService {
  async searchUsersByEmail(query: string): Promise<AdminUserOutDto[]> {
    const trimmed = query.trim();
    const filter = trimmed
      ? { email: { $regex: escapeRegex(trimmed), $options: "i" } }
      : {};

    const users = await UserModel.find(filter)
      .sort({ email: 1 })
      .limit(50)
      .exec();

    return users.map((user) => toAdminUser(user));
  }

  async updateUser(
    id: string,
    patch: UpdateAdminUserDto,
  ): Promise<AdminUserOutDto> {
    if (!Types.ObjectId.isValid(id)) {
      throw new Error("Invalid user id");
    }

    const user = await UserModel.findById(id);
    if (!user) {
      throw new Error("User not found");
    }

    if (patch.isBlocked === true && !user.isBlocked) {
      const isSuper = (user.roles ?? []).includes("super_admin");
      if (isSuper) {
        const active = await UserModel.countDocuments({
          roles: "super_admin",
          isBlocked: false,
        }).exec();
        if (active <= 1) {
          throw new Error("Cannot block the last super_admin");
        }
      }
    }

    if (patch.password !== undefined) {
      user.hashedPassword = await bcrypt.hash(patch.password, 10);
    }
    if (patch.isBlocked !== undefined) {
      user.isBlocked = patch.isBlocked;
    }

    await user.save();
    return toAdminUser(user);
  }

  async getUserDetail(id: string): Promise<AdminUserDetailOutDto> {
    if (!Types.ObjectId.isValid(id)) {
      throw new Error("Invalid user id");
    }

    const user = await UserModel.findById(id);
    if (!user) {
      throw new Error("User not found");
    }

    const createdAt =
      user.createdAt instanceof Date
        ? user.createdAt.toISOString()
        : user._id.getTimestamp().toISOString();

    return {
      ...toAdminUser(user),
      accountCreatedAt: createdAt,
    };
  }
}
