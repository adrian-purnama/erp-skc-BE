import type { Request, Response } from "express";
import { ApiResponseDto } from "../../../dto/apiResponse.dto";
import { fail, ok } from "../../../dto/httpResponse";
import { getUserPermissions } from "../../../core/permissions/resolve.service";
import {
  parseCreateRoleDto,
  parseUpdateRoleDto,
  parseUserRolesDto,
  RoleValidationError,
} from "../../../validation/role";
import { RoleConflictError, roleService } from "./role.service";

function readParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function sendRoleError(res: Response, error: unknown, fallback: string) {
  if (error instanceof RoleConflictError) {
    return res.status(409).json({
      success: false,
      message: error.message,
      data: { assignedUserCount: error.assignedUserCount },
    } satisfies ApiResponseDto<{ assignedUserCount: number }>);
  }
  if (error instanceof RoleValidationError) {
    return res.status(400).json({
      success: false,
      message: error.message,
      data: error.fields ? { fields: error.fields } : null,
    } satisfies ApiResponseDto<{ fields: Record<string, string> } | null>);
  }
  return fail(res, error, fallback);
}

export class RoleController {
  list = async (_req: Request, res: Response) => {
    try {
      const data = await roleService.list();
      return ok(res, "Roles retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to list roles");
    }
  };

  get = async (req: Request, res: Response) => {
    try {
      const key = readParam(req.params.key);
      const data = await roleService.get(key);
      return ok(res, "Role retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to get role");
    }
  };

  create = async (req: Request, res: Response) => {
    try {
      const input = parseCreateRoleDto(req.body);
      const actorPermissions = await getUserPermissions(req.user!);
      const data = await roleService.create(input, actorPermissions);
      return ok(res, "Role created", data, 201);
    } catch (error) {
      return sendRoleError(res, error, "Failed to create role");
    }
  };

  update = async (req: Request, res: Response) => {
    try {
      const key = readParam(req.params.key);
      const patch = parseUpdateRoleDto(req.body);
      const actorPermissions = await getUserPermissions(req.user!);
      const data = await roleService.update(key, patch, actorPermissions);
      return ok(res, "Role updated", data);
    } catch (error) {
      return sendRoleError(res, error, "Failed to update role");
    }
  };

  remove = async (req: Request, res: Response) => {
    try {
      const key = readParam(req.params.key);
      const force =
        req.query.force === "true" ||
        (Array.isArray(req.query.force) && req.query.force[0] === "true");
      await roleService.delete(key, force);
      return ok(res, "Role deleted", null);
    } catch (error) {
      return sendRoleError(res, error, "Failed to delete role");
    }
  };

  updateUserRoles = async (req: Request, res: Response) => {
    try {
      const id = readParam(req.params.id);
      const roles = parseUserRolesDto(req.body);
      const actorPermissions = await getUserPermissions(req.user!);
      const data = await roleService.assignUserRoles(
        id,
        roles,
        req.user!.id,
        actorPermissions,
      );
      return ok(res, "User roles updated", { roles: data });
    } catch (error) {
      return sendRoleError(res, error, "Failed to update roles");
    }
  };
}
