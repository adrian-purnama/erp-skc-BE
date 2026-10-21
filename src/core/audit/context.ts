import { AsyncLocalStorage } from "node:async_hooks";
import mongoose, { type ClientSession } from "mongoose";

export type AuditStore = {
  userId?: string;
  session?: ClientSession;
};

export const als = new AsyncLocalStorage<AuditStore>();

/**
 * withTransaction may retry the callback, so the callback must contain only DB operations.
 */
export async function withTx<T>(
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const store = als.getStore();
  if (store?.session) {
    return fn(store.session);
  }

  const session = await mongoose.startSession();
  let result!: T;
  try {
    await session.withTransaction(async () => {
      result = await als.run(
        { userId: store?.userId, session },
        () => fn(session),
      );
    });
    return result;
  } finally {
    await session.endSession();
  }
}
