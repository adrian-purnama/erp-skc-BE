import { Types } from "mongoose";
import { UserModel } from "../../models/user.model";

/** User lookups for other modules: display data only, never documents. */

export async function userEmailsById(
  ids: Array<string | Types.ObjectId>,
): Promise<Map<string, string>> {
  const unique = [
    ...new Set(
      ids.map(String).filter((id) => Types.ObjectId.isValid(id)),
    ),
  ];
  if (unique.length === 0) return new Map();
  const users = await UserModel.find({ _id: { $in: unique } })
    .select({ email: 1 })
    .lean()
    .exec();
  return new Map(
    users.map((u) => [String(u._id), u.email ?? String(u._id)] as const),
  );
}

export type UserRefLite = {
  id: string;
  name: string;
  profilePicture: string | null;
};

/** Display name + optional profile picture URL for RAB / audit user chips. */
export async function userRefsById(
  ids: Array<string | Types.ObjectId>,
): Promise<Map<string, UserRefLite>> {
  const unique = [
    ...new Set(
      ids.map(String).filter((id) => Types.ObjectId.isValid(id)),
    ),
  ];
  if (unique.length === 0) return new Map();
  const users = await UserModel.find({ _id: { $in: unique } })
    .select({ email: 1, fullName: 1, profilePicture: 1 })
    .lean()
    .exec();
  return new Map(
    users.map((u) => {
      const id = String(u._id);
      const fullName =
        typeof u.fullName === "string" ? u.fullName.trim() : "";
      const email = u.email ?? id;
      const pictureId = u.profilePicture ? String(u.profilePicture) : null;
      return [
        id,
        {
          id,
          name: fullName || email,
          profilePicture: pictureId ? `/media/${pictureId}` : null,
        } satisfies UserRefLite,
      ] as const;
    }),
  );
}

/** A user as other modules see it. `name` is the display name: full name, else email. */
export type UserRefDto = {
  id: string;
  name: string;
  fullName: string;
  email: string;
  isBlocked: boolean;
};

type UserLean = {
  _id: Types.ObjectId;
  fullName?: string;
  email?: string;
  isBlocked?: boolean;
};

function toUserRef(u: UserLean): UserRefDto {
  const fullName = typeof u.fullName === "string" ? u.fullName.trim() : "";
  const email = u.email ?? "";
  return { id: String(u._id), name: fullName || email, fullName, email, isBlocked: u.isBlocked === true };
}

const USER_REF_FIELDS = { fullName: 1, email: 1, isBlocked: 1 } as const;

/** One user (blocked or not), or null when the id is unknown or invalid. */
export async function getUserRef(id: string | Types.ObjectId | null | undefined): Promise<UserRefDto | null> {
  if (!id || !Types.ObjectId.isValid(String(id))) return null;
  const u = (await UserModel.findById(id).select(USER_REF_FIELDS).lean().exec()) as UserLean | null;
  return u ? toUserRef(u) : null;
}

/** id → display name for existing users. */
export async function getUserDisplayNames(
  ids: ReadonlyArray<string | Types.ObjectId>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.map(String))].filter((id) => Types.ObjectId.isValid(id));
  if (unique.length === 0) return new Map();
  const users = (await UserModel.find({ _id: { $in: unique } })
    .select(USER_REF_FIELDS)
    .lean()
    .exec()) as UserLean[];
  return new Map(users.map((u) => [String(u._id), toUserRef(u).name]));
}

/** Users who may be assigned work (PIC, buyer, …): not blocked, sorted by name. */
export async function listAssignableUsers(): Promise<UserRefDto[]> {
  const users = (await UserModel.find({ isBlocked: { $ne: true } })
    .select(USER_REF_FIELDS)
    .sort({ fullName: 1, email: 1 })
    .lean()
    .exec()) as UserLean[];
  return users.map(toUserRef);
}

/** The user must exist and not be blocked; errors read "`<role>` not found / is blocked". */
export async function assertAssignableUser(id: string, role = "User"): Promise<UserRefDto> {
  const user = await getUserRef(id);
  if (!user) throw new Error(`${role} not found`);
  if (user.isBlocked) throw new Error(`${role} is blocked`);
  return user;
}

/** Whether any user holds the super_admin role (blocked or not). */
export async function hasSuperAdmin(): Promise<boolean> {
  return (await UserModel.exists({ roles: "super_admin" })) !== null;
}
