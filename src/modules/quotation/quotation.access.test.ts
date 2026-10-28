import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isVerifyTokenShape,
  newVerifyToken,
  verifyState,
} from "./quotation.access";

describe("verify token", () => {
  it("is 43 url-safe chars and unique", () => {
    const a = newVerifyToken();
    const b = newVerifyToken();
    assert.ok(isVerifyTokenShape(a));
    assert.notEqual(a, b);
    assert.equal(isVerifyTokenShape("short"), false);
    assert.equal(isVerifyTokenShape(`${a.slice(0, 42)}$`), false);
  });
});

describe("verifyState", () => {
  const today = "2026-10-24";
  it("valid through the last day (inclusive)", () => {
    assert.equal(verifyState({ status: "issued", validUntil: "2026-10-24", todayYmd: today }), "valid");
  });
  it("expired after valid-until or without one", () => {
    assert.equal(verifyState({ status: "issued", validUntil: "2026-10-23", todayYmd: today }), "expired");
    assert.equal(verifyState({ status: "issued", validUntil: null, todayYmd: today }), "expired");
  });
  it("a won quotation shows like an issued one until Valid until", () => {
    assert.equal(verifyState({ status: "won", validUntil: "2026-10-24", todayYmd: today }), "valid");
    assert.equal(verifyState({ status: "won", validUntil: "2026-10-23", todayYmd: today }), "expired");
  });

  it("superseded and draft never show", () => {
    assert.equal(verifyState({ status: "superseded", validUntil: "2027-01-01", todayYmd: today }), "superseded");
    assert.equal(verifyState({ status: "draft", validUntil: "2027-01-01", todayYmd: today }), "unavailable");
  });
});
