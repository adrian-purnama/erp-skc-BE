import mongoose, { Types } from "mongoose";
import { logger } from "../../logger/logger";
import { AppConfigModel } from "../../models/appconfig/appconfig.model";
import { UserModel } from "../../models/user/user.model";
import { deleteFileIfExists, uploadFile } from "../../buckets/gridfs";

const logSource: string = "modules/appConfig/AppConfig.service.ts";

const DEFAULT_APP_NAME = "Adrian Template";
const DEFAULT_OPEN_LOGIN = true;
const DEFAULT_OPEN_REGISTER = true;

export type ChangePublicImageInput = {
  buffer: Buffer;
  filename: string;
  contentType: string;
};

type PublicImageField = "appLogo" | "companyProfile";

type ScalarField =
  | "appName"
  | "description"
  | "openLogin"
  | "openRegister"
  | "companyName"
  | "npwp"
  | "address"
  | "phone"
  | "email"
  | "website";

export class AppConfigService {
  appName: string = DEFAULT_APP_NAME;
  description: string = "";
  openLogin: boolean = DEFAULT_OPEN_LOGIN;
  openRegister: boolean = DEFAULT_OPEN_REGISTER;
  appLogo: Types.ObjectId | null = null;
  companyName: string = "";
  npwp: string = "";
  address: string = "";
  branchOfficeAddresses: string[] = [];
  phone: string = "";
  email: string = "";
  website: string = "";
  companyProfile: Types.ObjectId | null = null;
  firstRegister: boolean = true;

  async init(): Promise<void> {
    const checkAdmin = await UserModel.findOne({ roles: "super_admin" });
    this.firstRegister = !checkAdmin;

    const existAppConfig = await AppConfigModel.findOne();

    if (existAppConfig) {
      this.appName = existAppConfig.appName ?? DEFAULT_APP_NAME;
      this.description = existAppConfig.description ?? "";
      this.openLogin = existAppConfig.openLogin ?? DEFAULT_OPEN_LOGIN;
      this.openRegister = existAppConfig.openRegister ?? DEFAULT_OPEN_REGISTER;
      this.appLogo = existAppConfig.appLogo ?? null;
      this.companyName = existAppConfig.companyName ?? "";
      this.npwp = existAppConfig.npwp ?? "";
      this.address = existAppConfig.address ?? "";
      this.branchOfficeAddresses = Array.isArray(
        existAppConfig.branchOfficeAddresses,
      )
        ? existAppConfig.branchOfficeAddresses.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      this.phone = existAppConfig.phone ?? "";
      this.email = existAppConfig.email ?? "";
      this.website = existAppConfig.website ?? "";
      this.companyProfile = existAppConfig.companyProfile ?? null;

      logger.info("Existing app config found, not seeding", logSource, "init");
      return;
    }

    logger.info("No existing config found, beginning seeding process", logSource, "init");

    try {
      await AppConfigModel.create({
        appName: DEFAULT_APP_NAME,
        openLogin: DEFAULT_OPEN_LOGIN,
        openRegister: DEFAULT_OPEN_REGISTER,
      });

      this.appName = DEFAULT_APP_NAME;
      this.description = "";
      this.openLogin = DEFAULT_OPEN_LOGIN;
      this.openRegister = DEFAULT_OPEN_REGISTER;
      this.appLogo = null;
      this.companyName = "";
      this.npwp = "";
      this.address = "";
      this.branchOfficeAddresses = [];
      this.phone = "";
      this.email = "";
      this.website = "";
      this.companyProfile = null;

      logger.info("Seeding successful", logSource, "init");
    } catch (error) {
      logger.error(
        error instanceof Error ? error.message : String(error),
        logSource,
        "init",
      );
      throw error;
    }
  }

  markAdminRegistered(): void {
    this.firstRegister = false;
  }

  getAppConfig(): {
    appName: string;
    description: string;
    openLogin: boolean;
    openRegister: boolean;
    appLogo: string | null;
    companyName: string;
    npwp: string;
    address: string;
    branchOfficeAddresses: string[];
    phone: string;
    email: string;
    website: string;
    companyProfile: string | null;
  } {
    return {
      appName: this.appName,
      description: this.description,
      openLogin: this.openLogin,
      openRegister: this.openRegister,
      appLogo: this.appLogo ? `/media/${this.appLogo.toString()}` : null,
      companyName: this.companyName,
      npwp: this.npwp,
      address: this.address,
      branchOfficeAddresses: [...this.branchOfficeAddresses],
      phone: this.phone,
      email: this.email,
      website: this.website,
      companyProfile: this.companyProfile
        ? `/media/${this.companyProfile.toString()}`
        : null,
    };
  }

  async update(patch: {
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
  }): Promise<void> {
    const keys = [
      "appName",
      "description",
      "openLogin",
      "openRegister",
      "companyName",
      "npwp",
      "address",
      "phone",
      "email",
      "website",
    ] as const;
    for (const key of keys) {
      if (patch[key] !== undefined) {
        await this.updateField(key, patch[key] as this[typeof key]);
      }
    }
    if (patch.branchOfficeAddresses !== undefined) {
      await this.updateBranchOfficeAddresses(patch.branchOfficeAddresses);
    }
  }

  async changeAppLogo(
    input: ChangePublicImageInput,
  ): Promise<{ id: Types.ObjectId; url: string }> {
    return this.changePublicImage("appLogo", input);
  }

  async changeCompanyProfile(
    input: ChangePublicImageInput,
  ): Promise<{ id: Types.ObjectId; url: string }> {
    return this.changePublicImage("companyProfile", input);
  }

  private async changePublicImage(
    field: PublicImageField,
    input: ChangePublicImageInput,
  ): Promise<{ id: Types.ObjectId; url: string }> {
    try {
      const oldId = this[field];

      const uploaded = await uploadFile("public", {
        buffer: input.buffer,
        filename: input.filename,
        contentType: input.contentType,
        metadata: { kind: field },
      });

      try {
        await mongoose.connection.transaction(async (session) => {
          const updated = await AppConfigModel.findOneAndUpdate(
            {},
            { $set: { [field]: uploaded.id } },
            { new: true, session },
          );

          if (!updated) {
            await AppConfigModel.create(
              [
                {
                  appName: this.appName,
                  openLogin: this.openLogin,
                  openRegister: this.openRegister,
                  appLogo: field === "appLogo" ? uploaded.id : this.appLogo ?? undefined,
                  companyProfile:
                    field === "companyProfile"
                      ? uploaded.id
                      : this.companyProfile ?? undefined,
                  description: this.description || undefined,
                  companyName: this.companyName || undefined,
                  npwp: this.npwp || undefined,
                  address: this.address || undefined,
                  branchOfficeAddresses: this.branchOfficeAddresses,
                  phone: this.phone || undefined,
                  email: this.email || undefined,
                  website: this.website || undefined,
                },
              ],
              { session },
            );
          }
        });
      } catch (error) {
        await deleteFileIfExists("public", uploaded.id);
        throw error;
      }

      if (oldId) {
        await deleteFileIfExists("public", oldId);
      }

      this[field] = uploaded.id;

      return {
        id: uploaded.id,
        url: `/media/${uploaded.id.toString()}`,
      };
    } catch (error) {
      logger.error(
        error instanceof Error ? error.message : String(error),
        logSource,
        `changePublicImage:${field}`,
      );
      throw error;
    }
  }

  private async updateBranchOfficeAddresses(value: string[]): Promise<void> {
    try {
      const updated = await AppConfigModel.findOneAndUpdate(
        {},
        { $set: { branchOfficeAddresses: value } },
        { new: true },
      );

      if (!updated) {
        await AppConfigModel.create({
          appName: this.appName,
          openLogin: this.openLogin,
          openRegister: this.openRegister,
          appLogo: this.appLogo ?? undefined,
          companyProfile: this.companyProfile ?? undefined,
          description: this.description || undefined,
          companyName: this.companyName || undefined,
          npwp: this.npwp || undefined,
          address: this.address || undefined,
          branchOfficeAddresses: value,
          phone: this.phone || undefined,
          email: this.email || undefined,
          website: this.website || undefined,
        });
      }

      this.branchOfficeAddresses = value;
    } catch (error) {
      logger.error(
        error instanceof Error ? error.message : String(error),
        logSource,
        "updateBranchOfficeAddresses",
      );
      throw error;
    }
  }

  private async updateField<K extends ScalarField>(
    field: K,
    value: this[K],
  ): Promise<void> {
    try {
      const updated = await AppConfigModel.findOneAndUpdate(
        {},
        { $set: { [field]: value } },
        { new: true },
      );

      if (!updated) {
        await AppConfigModel.create({
          appName: this.appName,
          openLogin: this.openLogin,
          openRegister: this.openRegister,
          appLogo: this.appLogo ?? undefined,
          companyProfile: this.companyProfile ?? undefined,
          description: this.description || undefined,
          companyName: this.companyName || undefined,
          npwp: this.npwp || undefined,
          address: this.address || undefined,
          branchOfficeAddresses: this.branchOfficeAddresses,
          phone: this.phone || undefined,
          email: this.email || undefined,
          website: this.website || undefined,
          [field]: value,
        });
      }

      this[field] = value;
    } catch (error) {
      logger.error(
        error instanceof Error ? error.message : String(error),
        logSource,
        `change${field.charAt(0).toUpperCase()}${field.slice(1)}`,
      );
      throw error;
    }
  }
}

export const appConfigService = new AppConfigService();
