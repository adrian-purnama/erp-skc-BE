import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { AppConfigService } from "./AppConfig.service";
import { AppConfigModel } from "../../models/appconfig.model";

describe("AppConfigService.init firstRegister", () => {
  it("sets firstRegister false when a super_admin exists", async () => {
    mock.method(AppConfigModel, "findOne", async () => ({
      appName: "Test",
      openLogin: true,
      openRegister: true,
      appLogo: null,
    }));

    const service = new AppConfigService();
    await service.init({ hasSuperAdmin: async () => true });
    assert.equal(service.firstRegister, false);
  });
});
