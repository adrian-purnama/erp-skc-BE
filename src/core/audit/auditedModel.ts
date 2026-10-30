import mongoose, {
  type ClientSession,
  type Model,
  type Schema,
  type Types,
  type UpdateQuery,
} from "mongoose";
import { env } from "../env";
import { logger } from "../logger";
import { als, withTx } from "./context";

export type AuditAction = "A" | "U" | "D";

export interface AuditDoc {
  _id: Types.ObjectId;
  refId: Types.ObjectId;
  action: AuditAction;
  before: unknown;
  after: unknown;
  by?: Types.ObjectId;
  at: Date;
}

type LeanDoc = Record<string, unknown> & { _id: Types.ObjectId };

export type AuditedRepo<T> = {
  /** Read-only use (find, findOne, aggregate). Never write through it. */
  model: Model<T>;
  AuditModel: Model<AuditDoc>;
  init(): Promise<void>;
  create(data: Partial<T>): Promise<LeanDoc>;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: UpdateQuery<T>,
    options?: Record<string, unknown>,
  ): Promise<LeanDoc | null>;
  findByIdAndUpdate(
    id: Types.ObjectId | string,
    update: UpdateQuery<T>,
    options?: Record<string, unknown>,
  ): Promise<LeanDoc | null>;
  deleteOne(filter: Record<string, unknown>): Promise<LeanDoc | null>;
  deleteMany(
    filter: Record<string, unknown>,
  ): Promise<{ deletedCount: number }>;
};

export type AuditedCollectionInfo = {
  modelName: string;
  sourceCollection: string;
  auditCollection: string;
  AuditModel: Model<AuditDoc>;
};

const registry: Array<AuditedCollectionInfo & { init(): Promise<void> }> = [];

export function listAuditedCollections(): AuditedCollectionInfo[] {
  return registry.map(({ modelName, sourceCollection, auditCollection, AuditModel }) => ({
    modelName,
    sourceCollection,
    auditCollection,
    AuditModel,
  }));
}

export function getAuditModel(
  sourceCollection: string,
): AuditedCollectionInfo | undefined {
  return registry.find((r) => r.sourceCollection === sourceCollection);
}

function clean(doc: unknown): Record<string, unknown> | null {
  if (doc == null) return null;
  const plain =
    typeof doc === "object" &&
    doc !== null &&
    "toObject" in doc &&
    typeof (doc as { toObject: () => unknown }).toObject === "function"
      ? ((doc as { toObject: () => Record<string, unknown> }).toObject() as Record<
          string,
          unknown
        >)
      : ({ ...(doc as Record<string, unknown>) } as Record<string, unknown>);

  return plain;
}

function actorBy(): Types.ObjectId | undefined {
  const userId = als.getStore()?.userId;
  if (!userId) return undefined;
  return new mongoose.Types.ObjectId(userId);
}

async function writeAudit(
  AuditModel: Model<AuditDoc>,
  session: ClientSession,
  row: {
    refId: Types.ObjectId;
    action: AuditAction;
    before: unknown;
    after: unknown;
  },
): Promise<void> {
  await AuditModel.create(
    [
      {
        refId: row.refId,
        action: row.action,
        before: row.before,
        after: row.after,
        by: actorBy(),
      },
    ],
    { session },
  );
}

function isAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    code?: number | string;
    codeName?: string;
    message?: string;
  };
  if (e.code === 48 || e.codeName === "NamespaceExists") return true;
  if (typeof e.message === "string" && /already exists/i.test(e.message)) {
    return true;
  }
  return false;
}

export function auditedModel<T>(
  name: string,
  schema: Schema<T>,
): AuditedRepo<T> {
  const Model =
    (mongoose.models[name] as Model<T> | undefined) ??
    mongoose.model<T>(name, schema);
  const auditName = `adt${name}`;
  const auditCollection = `adt_${Model.collection.name}`;

  const auditSchema = new mongoose.Schema<AuditDoc>(
    {
      refId: { type: mongoose.Schema.Types.ObjectId, required: true },
      action: {
        type: String,
        required: true,
        enum: ["A", "U", "D"],
      },
      before: { type: mongoose.Schema.Types.Mixed },
      after: { type: mongoose.Schema.Types.Mixed },
      by: { type: mongoose.Schema.Types.ObjectId },
      at: { type: Date, default: Date.now },
    },
    { versionKey: false, collection: auditCollection },
  );
  auditSchema.index({ refId: 1, at: -1 });

  const blockedOps = [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "findOneAndDelete",
    "deleteOne",
    "deleteMany",
    "replaceOne",
  ] as const;

  for (const op of blockedOps) {
    auditSchema.pre(op, function () {
      throw new Error(`Audit collection is append-only; ${op} is not allowed`);
    });
  }

  const AuditModel =
    (mongoose.models[auditName] as Model<AuditDoc> | undefined) ??
    mongoose.model<AuditDoc>(auditName, auditSchema);

  const repo: AuditedRepo<T> & AuditedCollectionInfo = {
    model: Model,
    AuditModel,
    modelName: name,
    sourceCollection: Model.collection.name,
    auditCollection,

    async init() {
      try {
        await Model.createCollection();
      } catch (err) {
        if (!isAlreadyExistsError(err)) throw err;
      }
      try {
        await AuditModel.createCollection();
      } catch (err) {
        if (!isAlreadyExistsError(err)) throw err;
      }
    },

    async create(data) {
      return withTx(async (s) => {
        const created = (await Model.create(
          [data] as Parameters<Model<T>["create"]>[0][],
          { session: s },
        )) as Array<{
          _id: Types.ObjectId;
          toObject: () => Record<string, unknown>;
        }>;
        const doc = created[0];
        const after = clean(doc.toObject())!;
        await writeAudit(AuditModel, s, {
          refId: doc._id,
          action: "A",
          before: null,
          after,
        });
        return after as LeanDoc;
      });
    },

    async findOneAndUpdate(filter, update, options) {
      return withTx(async (s) => {
        const beforeRaw = await Model.findOne(filter).session(s).lean();
        if (!beforeRaw) return null;
        const before = clean(beforeRaw)! as LeanDoc;
        const afterRaw = await Model.findOneAndUpdate(
          { _id: before._id },
          update,
          {
            new: true,
            runValidators: true,
            ...options,
            session: s,
          },
        ).lean();
        const after = clean(afterRaw)! as LeanDoc;
        await writeAudit(AuditModel, s, {
          refId: before._id,
          action: "U",
          before,
          after,
        });
        return after;
      });
    },

    async findByIdAndUpdate(id, update, options) {
      return repo.findOneAndUpdate({ _id: id }, update, options);
    },

    async deleteOne(filter) {
      return withTx(async (s) => {
        const beforeRaw = await Model.findOne(filter).session(s).lean();
        if (!beforeRaw) return null;
        const before = clean(beforeRaw)! as LeanDoc;
        await Model.deleteOne({ _id: before._id }, { session: s });
        await writeAudit(AuditModel, s, {
          refId: before._id,
          action: "D",
          before,
          after: null,
        });
        return before;
      });
    },

    async deleteMany(filter) {
      return withTx(async (s) => {
        const beforesRaw = await Model.find(filter).session(s).lean();
        if (beforesRaw.length === 0) {
          return { deletedCount: 0 };
        }
        const befores = beforesRaw.map((d) => clean(d)! as LeanDoc);
        const ids = befores.map((d) => d._id);
        const result = await Model.deleteMany(
          { _id: { $in: ids } },
          { session: s },
        );
        await AuditModel.insertMany(
          befores.map((before) => ({
            refId: before._id,
            action: "D" as const,
            before,
            after: null,
            by: actorBy(),
          })),
          { session: s },
        );
        return { deletedCount: result.deletedCount };
      });
    },
  };

  registry.push(repo);
  return repo;
}

export async function initAuditCollections(): Promise<void> {
  for (const repo of registry) {
    await repo.init();
  }
}

export async function assertReplicaSet(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Audit requires a MongoDB connection");
  }
  const hello = (await db.admin().command({ hello: 1 })) as {
    setName?: string;
  };
  if (!hello.setName) {
    if (env.auditRequireReplicaSet) {
      throw new Error(
        "Audit requires a MongoDB replica set (transactions)",
      );
    }
    logger.warn(
      "MongoDB is not a replica set; audited writes will fail on first transaction",
      "core/audit/auditedModel.ts",
      "assertReplicaSet",
    );
  }
}
