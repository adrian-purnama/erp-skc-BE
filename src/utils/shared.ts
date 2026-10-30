import { Types } from "mongoose";
import { UserModel } from "../models/user.model";

const JAKARTA_TZ = "Asia/Jakarta";

const jakartaPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: JAKARTA_TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type JakartaYmdParts = {
  year: number;
  month: number;
  day: number;
};

export function jakartaYmdParts(now: Date = new Date()): JakartaYmdParts {
  const parts = jakartaPartsFormatter.formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    throw new Error("Failed to resolve Jakarta calendar date");
  }
  return { year, month, day };
}

export function jakartaYmdString(now: Date = new Date()): string {
  const { year, month, day } = jakartaYmdParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addJakartaDays(ymd: string, days: number): string {
  const [y, m, day] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, day + days));
  return utc.toISOString().slice(0, 10);
}

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
