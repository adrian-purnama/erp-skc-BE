import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseCreateProjectDto,
  parseUpdateProjectDto,
} from "../../validation/project";

const validContact = {
  name: "Ada",
  gender: "female",
  contact: { email: "ada@example.com", phone1: "0812" },
};

describe("project validation", () => {
  it("requires name, customerId, and customerContact", () => {
    assert.throws(() => parseCreateProjectDto({}), /name is required/);
    assert.throws(
      () =>
        parseCreateProjectDto({
          name: "P1",
          customerContact: validContact,
        }),
      /customerId is required/,
    );
    assert.throws(
      () =>
        parseCreateProjectDto({
          name: "P1",
          customerId: "aaaaaaaaaaaaaaaaaaaaaaaa",
        }),
      /customerContact is required/,
    );
  });

  it("parses create dto and trims fields", () => {
    const dto = parseCreateProjectDto({
      name: "  Alpha  ",
      description: "  note  ",
      customerId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      customerContact: {
        name: "  Ada  ",
        gender: "female",
        contact: { email: " ada@example.com ", phone1: "0812" },
      },
    });
    assert.deepEqual(dto, {
      name: "Alpha",
      description: "note",
      customerId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      customerContact: {
        name: "Ada",
        gender: "female",
        contact: { email: "ada@example.com", phone1: "0812" },
      },
      status: "open",
      loseReason: null,
      closeReason: null,
    });
  });

  it("requires loseReason when status is lose", () => {
    assert.throws(
      () =>
        parseCreateProjectDto({
          name: "P1",
          customerId: "aaaaaaaaaaaaaaaaaaaaaaaa",
          customerContact: validContact,
          status: "lose",
        }),
      /loseReason is required/,
    );
    const dto = parseCreateProjectDto({
      name: "P1",
      customerId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      customerContact: validContact,
      status: "lose",
      loseReason: "price",
    });
    assert.equal(dto.status, "lose");
    assert.equal(dto.loseReason, "price");
    assert.equal(dto.closeReason, null);
  });

  it("requires closeReason when status is close", () => {
    assert.throws(
      () =>
        parseUpdateProjectDto({
          status: "close",
        }),
      /closeReason is required/,
    );
    const patch = parseUpdateProjectDto({
      status: "close",
      closeReason: "completed",
    });
    assert.deepEqual(patch, {
      status: "close",
      loseReason: null,
      closeReason: "completed",
    });
  });

  it("rejects invalid gender and does not accept projectNumber on create", () => {
    assert.throws(
      () =>
        parseCreateProjectDto({
          name: "P1",
          customerId: "aaaaaaaaaaaaaaaaaaaaaaaa",
          customerContact: { ...validContact, gender: "other" },
        }),
      /gender must be male or female/,
    );
    const dto = parseCreateProjectDto({
      name: "P1",
      customerId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      customerContact: validContact,
      projectNumber: "PRJ/I/2026/0001",
    });
    assert.equal(
      "projectNumber" in dto,
      false,
      "projectNumber must not be client-set",
    );
  });

  it("update rejects empty patch and accepts isActive", () => {
    assert.throws(() => parseUpdateProjectDto({}), /No fields to update/);
    const patch = parseUpdateProjectDto({ isActive: false });
    assert.deepEqual(patch, { isActive: false });
  });
});
