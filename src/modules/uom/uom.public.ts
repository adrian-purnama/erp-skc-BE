import { Types } from "mongoose";
import { UomRepo } from "../../models/uom.model";

export { UOM_DEFAULT_DECIMALS, UOM_MAX_DECIMALS } from "../../models/uom.model";

/** A UoM is active unless it was explicitly deactivated. */
const ACTIVE_FILTER = { isActive: { $ne: false } } as const;

/** An active UoM for pick lists and imports. */
export type UomOptionDto = { id: string; symbol: string; name: string };

/** A UoM as other modules see it; `formulas` / `decimals` are raw (callers apply defaults). */
export type UomRefDto = {
  id: string;
  symbol: string;
  name: string;
  formulas: string[] | undefined;
  decimals: number | undefined;
};

const toObjectIds = (ids: readonly string[]) =>
  [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));

/** Active UoMs, in store order unless `sorted` (by symbol). */
export async function listActiveUoms(opts: { sorted?: boolean } = {}): Promise<UomOptionDto[]> {
  let q = UomRepo.model.find(ACTIVE_FILTER).select({ symbol: 1, name: 1 });
  if (opts.sorted) q = q.sort({ symbol: 1 });
  const docs = await q.lean().exec();
  return docs.map((u) => ({ id: String(u._id), symbol: u.symbol, name: u.name }));
}

/** UoM id → UoM, active or not (stored references must still resolve). */
export async function getUomsByIds(ids: readonly string[]): Promise<Map<string, UomRefDto>> {
  const oids = toObjectIds(ids);
  if (oids.length === 0) return new Map();
  const docs = await UomRepo.model.find({ _id: { $in: oids } }).lean().exec();
  return new Map(
    docs.map((u) => [
      String(u._id),
      { id: String(u._id), symbol: u.symbol, name: u.name, formulas: u.formulas, decimals: u.decimals },
    ]),
  );
}
