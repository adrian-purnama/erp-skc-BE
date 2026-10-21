import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { AdminService } from "./admin.service";
import { UserModel } from "../../models/user/user.model";

describe("AdminService last super_admin block guard", () => {
  it("rejects blocking the only unblocked super_admin when another is blocked", async () => {
    mock.method(UserModel, "findById", async () => ({
      id: "u1",
      email: "a@b.com",
      isBlocked: false,
      roles: ["super_admin"],
      hashedPassword: "x",
      save: async function save(this: { isBlocked: boolean }) {
        this.isBlocked = true;
      },
    }));
    mock.method(UserModel, "countDocuments", () => ({
      exec: async () => 1,
    }));

    const service = new AdminService();
    await assert.rejects(
      () => service.updateUser("507f1f77bcf86cd799439011", { isBlocked: true }),
      /last super_admin/,
    );
  });
});
