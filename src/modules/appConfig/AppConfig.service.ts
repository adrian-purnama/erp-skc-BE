import mongoose, { Types } from "mongoose";
import { logger } from "../../logger/logger";
import { AppConfigModel } from "../../models/appconfig/appconfig.model";
import { UserModel } from "../../models/user/user.model";
import { deleteFileIfExists, uploadFile } from "../../buckets/gridfs";

const logSource: string = "modules/appConfig/AppConfig.service.ts";

const DEFAULT_APP_NAME = "Adrian Template";
const DEFAULT_OPEN_LOGIN = true;
const DEFAULT_OPEN_REGISTER = true;

export type ChangeAppLogoInput = {
  buffer: Buffer;
  filename: string;
  contentType: string;
};

export class AppConfigService {
  appName: string = DEFAULT_APP_NAME;
  openLogin: boolean = DEFAULT_OPEN_LOGIN;
  openRegister: boolean = DEFAULT_OPEN_REGISTER;
  appLogo: Types.ObjectId | null = null;
  firstRegister: boolean = true;

  async init(): Promise<void> {
    const checkAdmin = await UserModel.findOne({ roles: "super_admin" });
    this.firstRegister = !checkAdmin;

    const existAppConfig = await AppConfigModel.findOne();

    if (existAppConfig) {
      this.appName = existAppConfig.appName ?? DEFAULT_APP_NAME;
      this.openLogin = existAppConfig.openLogin ?? DEFAULT_OPEN_LOGIN;
      this.openRegister = existAppConfig.openRegister ?? DEFAULT_OPEN_REGISTER;
      this.appLogo = existAppConfig.appLogo ?? null;

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
      this.openLogin = DEFAULT_OPEN_LOGIN;
      this.openRegister = DEFAULT_OPEN_REGISTER;
      this.appLogo = null;

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
    openLogin: boolean;
    openRegister: boolean;
    appLogo: string | null;
  } {
    return {
      appName: this.appName,
      openLogin: this.openLogin,
      openRegister: this.openRegister,
      appLogo: this.appLogo ? `/media/${this.appLogo.toString()}` : null,
    };
  }

  async changeAppName(appName: string): Promise<void> {
    await this.updateField("appName", appName);
  }

  async changeOpenLogin(openLogin: boolean): Promise<void> {
    await this.updateField("openLogin", openLogin);
  }

  async changeOpenRegister(openRegister: boolean): Promise<void> {
    await this.updateField("openRegister", openRegister);
  }

  
  async changeAppLogo(
    input: ChangeAppLogoInput,
  ): Promise<{ id: Types.ObjectId; url: string }> {
    try {
      const oldId = this.appLogo;

      const uploaded = await uploadFile("public", {
        buffer: input.buffer,
        filename: input.filename,
        contentType: input.contentType,
        metadata: { kind: "appLogo" },
      });

      try {
        await mongoose.connection.transaction(async (session) => {
          const updated = await AppConfigModel.findOneAndUpdate(
            {},
            { $set: { appLogo: uploaded.id } },
            { new: true, session },
          );

          if (!updated) {
            await AppConfigModel.create(
              [
                {
                  appName: this.appName,
                  openLogin: this.openLogin,
                  openRegister: this.openRegister,
                  appLogo: uploaded.id,
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

      this.appLogo = uploaded.id;

      return {
        id: uploaded.id,
        url: `/media/${uploaded.id.toString()}`,
      };
    } catch (error) {
      logger.error(
        error instanceof Error ? error.message : String(error),
        logSource,
        "changeAppLogo",
      );
      throw error;
    }
  }

  private async updateField<K extends "appName" | "openLogin" | "openRegister">(
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
