import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { AppConfigService } from "./AppConfig.service";
import { UserModel } from "../../models/user.model";
import { AppConfigModel } from "../../models/appconfig.model";

describe("AppConfigService.init firstRegister", () => {
  it("sets firstRegister false when a super_admin exists", async () => {
    mock.method(UserModel, "findOne", async () => ({
      roles: ["super_admin"],
    }));
    mock.method(AppConfigModel, "findOne", async () => ({
      appName: "Test",
      openLogin: true,
      openRegister: true,
      appLogo: null,
    }));

    const service = new AppConfigService();
    await service.init();
    assert.equal(service.firstRegister, false);
  });
});
