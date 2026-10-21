import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signAccessToken, verifyAccessToken } from "./jwt";

describe("jwt payload", () => {
  it("does not include isAdmin", () => {
    const token = signAccessToken({
      userId: "abc",
      email: "a@b.com",
      rememberMe: false,
    });
    const payload = verifyAccessToken(token) as Record<string, unknown>;
    assert.equal(payload.userId, "abc");
    assert.equal(payload.email, "a@b.com");
    assert.equal("isAdmin" in payload, false);
  });

  it("still verifies legacy tokens that include isAdmin", () => {
    const jwt = require("jsonwebtoken");
    const { env } = require("../environment/env");
    const token = jwt.sign(
      { userId: "abc", email: "a@b.com", isAdmin: true },
      env.jwtSecret,
      { expiresIn: "1h" },
    );
    const payload = verifyAccessToken(token);
    assert.equal(payload.userId, "abc");
  });
});
