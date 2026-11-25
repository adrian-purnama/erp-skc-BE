import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { UserModel } from "../../models/user.model";
import {
  assertAssignableUser,
  getUserDisplayNames,
  getUserRef,
  listAssignableUsers,
} from "./user.public";

function query<T>(value: T) {
  const q = { select: () => q, sort: () => q, lean: () => q, exec: async () => value };
  return q;
}

const U = "6ae9bd7a2e3bbc05e91395a1";

describe("user public API", () => {
  afterEach(() => mock.restoreAll());

  it("display name is the trimmed full name, else the email", async () => {
    mock.method(UserModel, "findById", () =>
      query({ _id: new Types.ObjectId(U), fullName: "  Sari  ", email: "s@x.test" }),
    );
    assert.deepEqual(await getUserRef(U), {
      id: U,
      name: "Sari",
      fullName: "Sari",
      email: "s@x.test",
      isBlocked: false,
    });

    mock.restoreAll();
    mock.method(UserModel, "find", () =>
      query([{ _id: new Types.ObjectId(U), fullName: " ", email: "s@x.test" }]),
    );
    assert.equal((await getUserDisplayNames([U])).get(U), "s@x.test");
  });

  it("returns null for an invalid id without querying", async () => {
    const findById = mock.method(UserModel, "findById", () => query(null));
    assert.equal(await getUserRef("nope"), null);
    assert.equal(findById.mock.callCount(), 0);
  });

  it("assertAssignableUser rejects missing and blocked users with the role in the message", async () => {
    mock.method(UserModel, "findById", () => query(null));
    await assert.rejects(assertAssignableUser(U, "PIC user"), new Error("PIC user not found"));

    mock.restoreAll();
    mock.method(UserModel, "findById", () =>
      query({ _id: new Types.ObjectId(U), email: "b@x.test", isBlocked: true }),
    );
    await assert.rejects(assertAssignableUser(U, "PIC user"), new Error("PIC user is blocked"));
  });

  it("lists only users who are not blocked", async () => {
    const filters: unknown[] = [];
    mock.method(UserModel, "find", (f: unknown) => {
      filters.push(f);
      return query([]);
    });
    await listAssignableUsers();
    assert.deepEqual(filters, [{ isBlocked: { $ne: true } }]);
  });
});
