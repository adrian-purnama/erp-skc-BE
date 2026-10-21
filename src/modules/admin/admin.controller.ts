import type { Request, Response } from "express";
import { fail, ok } from "../../dto/httpResponse";
import {
  parseEmailSearchQuery,
  parseUpdateAdminUserDto,
} from "../../validation/adminUser";
import { parseRouteId } from "../../validation/parseParam";
import { appConfigService } from "../appConfig/AppConfig.service";
import { AdminService } from "./admin.service";

export class AdminController {
  constructor(private readonly adminService = new AdminService()) {}

  getAppConfig = async (_req: Request, res: Response) => {
    try {
      const data = appConfigService.getAppConfig();

      return ok(res, "App config retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to get app config");
    }
  };

  updateAppConfig = async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const patch: {
        appName?: string;
        openLogin?: boolean;
        openRegister?: boolean;
      } = {};

      if ("appName" in body) {
        if (typeof body.appName !== "string" || !body.appName.trim()) {
          return fail(res, null, "appName must be a non-empty string");
        }
        patch.appName = body.appName.trim();
      }

      if ("openLogin" in body) {
        if (typeof body.openLogin !== "boolean") {
          return fail(res, null, "openLogin must be a boolean");
        }
        patch.openLogin = body.openLogin;
      }

      if ("openRegister" in body) {
        if (typeof body.openRegister !== "boolean") {
          return fail(res, null, "openRegister must be a boolean");
        }
        patch.openRegister = body.openRegister;
      }

      if (
        patch.appName === undefined &&
        patch.openLogin === undefined &&
        patch.openRegister === undefined
      ) {
        return fail(res, null, "No valid fields to update");
      }

      if (patch.appName !== undefined) {
        await appConfigService.changeAppName(patch.appName);
      }
      if (patch.openLogin !== undefined) {
        await appConfigService.changeOpenLogin(patch.openLogin);
      }
      if (patch.openRegister !== undefined) {
        await appConfigService.changeOpenRegister(patch.openRegister);
      }
      const data = appConfigService.getAppConfig();

      return ok(res, "App config updated", data);
    } catch (error) {
      return fail(res, error, "Failed to update app config");
    }
  };

  updateAppLogo = async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return fail(res, null, "file required");
      }

      const result = await appConfigService.changeAppLogo({
        buffer: req.file.buffer,
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      return ok(res, "App logo updated", {
        id: result.id.toString(),
        url: result.url,
      });
    } catch (error) {
      return fail(res, error, "Failed to update app logo");
    }
  };

  getUser = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const data = await this.adminService.getUserDetail(id);
      return ok(res, "User retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to get user");
    }
  };

  searchUsers = async (req: Request, res: Response) => {
    try {
      const query = parseEmailSearchQuery(req.query.email);
      const data = await this.adminService.searchUsersByEmail(query);
      return ok(res, "Users retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to search users");
    }
  };

  updateUser = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const patch = parseUpdateAdminUserDto(req.body);
      const data = await this.adminService.updateUser(id, patch);
      return ok(res, "User updated", data);
    } catch (error) {
      return fail(res, error, "Failed to update user");
    }
  };
}
