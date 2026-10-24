import { Types } from "mongoose";

export function parseRouteId(param: string | string[] | undefined): string {
  const id = Array.isArray(param) ? param[0] : param;
  if (!id || !Types.ObjectId.isValid(id)) {
    throw new Error("Invalid id");
  }
  return id;
}
