import { Types } from "mongoose";

export function parseParam(
  param: string | string[] | undefined,
  options: { label: string; objectId?: boolean },
): string {
  const id = Array.isArray(param) ? param[0] : param;

  if (options.objectId) {
    if (!id || !Types.ObjectId.isValid(id)) {
      throw new Error(`Invalid ${options.label}`);
    }
    return id;
  }

  if (!id) {
    throw new Error(`${options.label} required`);
  }

  return id;
}

export function parseRouteId(param: string | string[] | undefined): string {
  return parseParam(param, { label: "id", objectId: true });
}
