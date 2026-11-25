import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTokenRevoked, signAccessToken, verifyAccessToken } from "./jwt";

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
    const { env } = require("../core/env");
    const token = jwt.sign(
      { userId: "abc", email: "a@b.com", isAdmin: true },
      env.jwtSecret,
      { expiresIn: "1h" },
    );
    const payload = verifyAccessToken(token);
    assert.equal(payload.userId, "abc");
  });
});

describe("token lifetime", () => {
  const jwt = require("jsonwebtoken");
  function lifetimeSeconds(rememberMe: boolean): number {
    const token = signAccessToken({ userId: "abc", email: "a@b.com", rememberMe });
    const { iat, exp } = jwt.decode(token) as { iat: number; exp: number };
    return exp - iat;
  }

  it("lasts 1 day without remember me", () => {
    assert.equal(lifetimeSeconds(false), 24 * 60 * 60);
  });

  it("lasts 30 days with remember me", () => {
    assert.equal(lifetimeSeconds(true), 30 * 24 * 60 * 60);
  });
});

describe("isTokenRevoked", () => {
  const changedAt = new Date("2026-11-24T10:00:00.500Z");
  const changedSec = Math.floor(changedAt.getTime() / 1000);

  it("keeps tokens when the password was never changed", () => {
    assert.equal(isTokenRevoked(0, undefined), false);
    assert.equal(isTokenRevoked(0, null), false);
  });

  it("revokes tokens issued before the change", () => {
    assert.equal(isTokenRevoked(changedSec - 1, changedAt), true);
  });

  it("keeps tokens issued in the same second or later", () => {
    assert.equal(isTokenRevoked(changedSec, changedAt), false);
    assert.equal(isTokenRevoked(changedSec + 60, changedAt), false);
  });
});
