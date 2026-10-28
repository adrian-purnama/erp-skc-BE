import type { Request, Response } from "express";
import { fail, handle, ok } from "../../dto/httpResponse";
import { parseUpdateAdminUserDto } from "../../validation/adminUser";
import { parseRouteId } from "../../validation/parseParam";
import { queryString } from "../../validation/query";
import { appConfigService } from "../appConfig/AppConfig.service";
import { AdminService } from "./admin.service";

export class AdminController {
  constructor(private readonly adminService = new AdminService()) {}

  getAppConfig = async (_req: Request, res: Response) => {
    return handle(res, "Failed to get app config", "App config retrieved", () =>
      Promise.resolve(appConfigService.getAppConfig()),
    );
  };

  updateAppConfig = async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const patch: {
        appName?: string;
        description?: string;
        openLogin?: boolean;
        openRegister?: boolean;
        companyName?: string;
        npwp?: string;
        address?: string;
        branchOfficeAddresses?: string[];
        phone?: string;
        email?: string;
        website?: string;
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

      const optionalStrings = [
        "description",
        "companyName",
        "npwp",
        "address",
        "phone",
        "email",
        "website",
      ] as const;
      for (const key of optionalStrings) {
        if (!(key in body)) continue;
        if (typeof body[key] !== "string") {
          return fail(res, null, `${key} must be a string`);
        }
        patch[key] = body[key].trim();
      }

      if ("branchOfficeAddresses" in body) {
        if (!Array.isArray(body.branchOfficeAddresses)) {
          return fail(res, null, "branchOfficeAddresses must be an array of strings");
        }
        const addresses: string[] = [];
        for (const entry of body.branchOfficeAddresses) {
          if (typeof entry !== "string") {
            return fail(
              res,
              null,
              "branchOfficeAddresses must be an array of strings",
            );
          }
          const trimmed = entry.trim();
          if (trimmed) addresses.push(trimmed);
        }
        patch.branchOfficeAddresses = addresses;
      }

      if (
        patch.appName === undefined &&
        patch.description === undefined &&
        patch.openLogin === undefined &&
        patch.openRegister === undefined &&
        patch.companyName === undefined &&
        patch.npwp === undefined &&
        patch.address === undefined &&
        patch.branchOfficeAddresses === undefined &&
        patch.phone === undefined &&
        patch.email === undefined &&
        patch.website === undefined
      ) {
        return fail(res, null, "No valid fields to update");
      }

      await appConfigService.update(patch);
      return ok(res, "App config updated", appConfigService.getAppConfig());
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

  updateCompanyProfile = async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return fail(res, null, "file required");
      }

      const result = await appConfigService.changeCompanyProfile({
        buffer: req.file.buffer,
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      return ok(res, "Company profile updated", {
        id: result.id.toString(),
        url: result.url,
      });
    } catch (error) {
      return fail(res, error, "Failed to update company profile");
    }
  };

  getUser = async (req: Request, res: Response) => {
    return handle(res, "Failed to get user", "User retrieved", () =>
      this.adminService.getUserDetail(parseRouteId(req.params.id)),
    );
  };

  searchUsers = async (req: Request, res: Response) => {
    const query = queryString(req.query.email) ?? "";
    return handle(res, "Failed to search users", "Users retrieved", () =>
      this.adminService.searchUsersByEmail(query),
    );
  };

  updateUser = async (req: Request, res: Response) => {
    return handle(res, "Failed to update user", "User updated", () =>
      this.adminService.updateUser(
        parseRouteId(req.params.id),
        parseUpdateAdminUserDto(req.body),
      ),
    );
  };
}
