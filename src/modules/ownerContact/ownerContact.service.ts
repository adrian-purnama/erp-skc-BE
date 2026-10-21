import { Types, type Model } from "mongoose";

type ContactDoc<V extends string, T extends string> = {
  ownerId: Types.ObjectId;
  type: T;
  isPreferred: boolean;
} & Record<V, string>;

export type OwnerContactOut<V extends string, T extends string> = {
  id: string;
  ownerId: string;
  type: T;
  isPreferred: boolean;
} & Record<V, string>;

export type OwnerContactUpsertInput<V extends string, T extends string> = {
  type: T;
  isPreferred?: boolean;
} & Record<V, string>;

export type OwnerContactReplaceRow<
  V extends string,
  T extends string,
> = OwnerContactUpsertInput<V, T> & { id?: string };

export type OwnerContactConfig<V extends string, T extends string> = {
  model: Model<ContactDoc<V, T>>;
  valueField: V;
  types: readonly T[];
  label: string;
};

export function createOwnerContactService<V extends string, T extends string>(
  cfg: OwnerContactConfig<V, T>,
) {
  const { model, valueField, types, label } = cfg;
  type Out = OwnerContactOut<V, T>;
  type Row = OwnerContactReplaceRow<V, T>;

  const toOut = (doc: ContactDoc<V, T> & { _id: Types.ObjectId }): Out =>
    ({
      id: String(doc._id),
      ownerId: String(doc.ownerId),
      [valueField]: doc[valueField],
      type: doc.type,
      isPreferred: doc.isPreferred,
    }) as Out;

  const normalizePreferred = (rows: Row[]): Row[] => {
    if (rows.length === 0) return rows;
    const preferredIndex = rows.findIndex((r) => r.isPreferred);
    const keep = preferredIndex >= 0 ? preferredIndex : 0;
    return rows.map((row, i) => ({ ...row, isPreferred: i === keep }));
  };

  return {
    async listByOwner(ownerId: string): Promise<Out[]> {
      if (!Types.ObjectId.isValid(ownerId)) return [];
      const docs = await model
        .find({ ownerId })
        .sort({ isPreferred: -1, createdAt: 1 })
        .lean()
        .exec();
      return docs.map((d) => toOut(d as ContactDoc<V, T> & { _id: Types.ObjectId }));
    },

    async replaceForOwner(ownerId: string, rows: Row[]): Promise<Out[]> {
      if (!Types.ObjectId.isValid(ownerId)) {
        throw new Error("Invalid ownerId");
      }
      const ownerOid = new Types.ObjectId(ownerId);
      const normalized = normalizePreferred(rows);

      const keepIds = new Set<string>();
      for (const row of normalized) {
        if (row.id && Types.ObjectId.isValid(row.id)) keepIds.add(row.id);
      }

      if (keepIds.size > 0) {
        await model
          .deleteMany({
            ownerId: ownerOid,
            _id: { $nin: [...keepIds].map((id) => new Types.ObjectId(id)) },
          })
          .exec();
      } else {
        await model.deleteMany({ ownerId: ownerOid }).exec();
      }

      const results: Out[] = [];
      for (const row of normalized) {
        const value = row[valueField].trim();
        if (!value) throw new Error(`${label} ${valueField} required`);
        if (!types.includes(row.type)) {
          throw new Error(`Invalid ${label.toLowerCase()} type`);
        }
        const fields = {
          [valueField]: value,
          type: row.type,
          isPreferred: Boolean(row.isPreferred),
        };

        if (row.id && Types.ObjectId.isValid(row.id)) {
          const updated = await model
            .findOneAndUpdate(
              { _id: row.id, ownerId: ownerOid },
              { $set: fields },
              { new: true },
            )
            .lean()
            .exec();
          if (updated) {
            results.push(
              toOut(updated as ContactDoc<V, T> & { _id: Types.ObjectId }),
            );
            continue;
          }
        }

        const created = await model.create({
          ownerId: ownerOid,
          ...fields,
        } as ContactDoc<V, T>);
        results.push(
          toOut(created.toObject() as ContactDoc<V, T> & { _id: Types.ObjectId }),
        );
      }

      return results;
    },

    async deleteByOwner(ownerId: string): Promise<void> {
      if (!Types.ObjectId.isValid(ownerId)) return;
      await model.deleteMany({ ownerId }).exec();
    },
  };
}
