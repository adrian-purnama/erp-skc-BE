import { Types } from "mongoose";
import type { SaveProductionProcessInDto } from "../../dto/production.dto";
import { ProductionOrderRepo } from "../../models/productionOrder.model";
import { logger } from "../../core/logger";
import { userEmailsById } from "../auth";
import {
  getProjectRef,
  projectRabChangeService,
  projectRabService,
} from "../project";
import { countLivePurchasesForSpks } from "../purchasing";
import {
  assertLabourStages,
  assertProcessChange,
  type ProcessLine,
} from "./production.planner";
import { doneByLineForItems, itemLabourLines, orderLineKey } from "./stageFlow";

type ProcessRow = ProcessLine & {
  /** Present on stages new to the RAB. */
  add?: { labourItemId: string; labourUomId: string; totalQty: string; unitPrice: string };
};

/**
 * The Production process editor: one item's stages (role, executor,
 * sequence, weight), saved as a RAB change that is opened, applied and
 * committed in one go so it shows in the RAB activity.
 */
export class ProductionProcessService {
  async save(
    projectId: string,
    itemId: string,
    userId: string,
    input: SaveProductionProcessInDto,
  ): Promise<void> {
    const project = await getProjectRef(projectId);
    if (!project) throw new Error("Project not found");
    if (!project.productionReleasedAt) {
      throw new Error("Release the project to production before setting up its process");
    }
    const open = await projectRabChangeService.findOpenDraft(projectId);
    if (open) {
      const by = (await userEmailsById([String(open.openedBy)])).get(String(open.openedBy));
      throw new Error(
        `A RAB change is already open${by ? ` by ${by}` : ""}: commit or discard it first`,
      );
    }

    const before = await itemLabourLines(projectId, itemId);
    const beforeByKey = new Map(before.map((l) => [l.key, l]));
    const rows = input.lines.map((l): ProcessRow => {
      if (l.key !== undefined) {
        const line = beforeByKey.get(l.key);
        if (!line) throw new Error("A stage is no longer on this item's RAB: reload and try again");
        return { ...l, key: l.key, name: line.name };
      }
      const key = `${itemId}:${l.labourItemId}:${l.labourUomId}`;
      if (beforeByKey.has(key)) throw new Error("This labour item and UOM are already a stage");
      return {
        key,
        role: l.role,
        executor: l.executor,
        sequence: l.sequence,
        weightPercent: l.weightPercent,
        name: "New stage",
        add: {
          labourItemId: l.labourItemId,
          labourUomId: l.labourUomId,
          totalQty: l.totalQty,
          unitPrice: l.unitPrice,
        },
      };
    });
    if (new Set(rows.map((r) => r.key)).size !== rows.length) {
      throw new Error("A labour item and UOM can be one stage only");
    }
    assertLabourStages(rows);

    const keptKeys = new Set(rows.map((r) => r.key));
    const removed = before.filter((l) => !keptKeys.has(l.key));
    const added = rows.filter((r) => r.add);
    const changed = rows.some((r) => {
      const b = beforeByKey.get(r.key);
      return (
        !b ||
        b.role !== r.role ||
        b.executor !== r.executor ||
        b.sequence !== r.sequence ||
        b.weightPercent !== r.weightPercent
      );
    });
    if (!changed && removed.length === 0) throw new Error("Nothing changed");

    const orders = await ProductionOrderRepo.model
      .find({ projectId: new Types.ObjectId(projectId), shopDrawingItemId: new Types.ObjectId(itemId) })
      .select({ shopDrawingItemId: 1, labourItemId: 1, labourUomId: 1, status: 1 })
      .lean()
      .exec();
    const liveKeys = new Set(orders.filter((o) => o.status !== "cancelled").map(orderLineKey));
    assertProcessChange({
      before,
      after: rows,
      liveKeys,
      doneByLine: await doneByLineForItems([new Types.ObjectId(itemId)]),
    });
    for (const line of removed) {
      await assertNoPurchaseOnLine(
        line.name,
        orders.filter((o) => orderLineKey(o) === line.key).map((o) => o._id),
      );
    }

    await projectRabChangeService.open(projectId, userId, { reason: input.reason }, "production");
    try {
      for (const line of removed) {
        await projectRabService.removeLabourLine(projectId, line.key);
      }
      for (const row of added) {
        await projectRabService.addLabourLine(projectId, userId, {
          shopDrawingItemId: itemId,
          itemId: row.add!.labourItemId,
          itemUomId: row.add!.labourUomId,
          totalQty: row.add!.totalQty,
          unitPrice: row.add!.unitPrice,
        });
      }
      await projectRabService.saveLabourProcess(projectId, {
        shopDrawingItemId: itemId,
        lines: rows.map((r) => ({
          key: r.key,
          role: r.role,
          executor: r.executor,
          sequence: r.sequence,
          weightPercent: r.weightPercent,
        })),
      });
      await projectRabChangeService.commit(projectId, userId);
    } catch (error) {
      try {
        await projectRabChangeService.discard(projectId, userId);
      } catch (discardError) {
        logger.error(
          `Failed to discard production process change: ${discardError instanceof Error ? discardError.message : String(discardError)}`,
          "modules/production/productionProcess.service.ts",
          "save",
        );
      }
      throw error;
    }

    // Live SPKs show their line's current stage number.
    for (const row of rows) {
      const ids = orders
        .filter((o) => o.status !== "cancelled" && orderLineKey(o) === row.key)
        .map((o) => o._id);
      if (ids.length === 0) continue;
      await ProductionOrderRepo.model
        .updateMany({ _id: { $in: ids } }, { $set: { sequence: row.sequence } })
        .exec();
    }
  }
}

/** A stage can't leave the RAB while a live SPP / PO still points at one of its SPKs. */
async function assertNoPurchaseOnLine(name: string, orderIds: Types.ObjectId[]): Promise<void> {
  if (orderIds.length === 0) return;
  if ((await countLivePurchasesForSpks(orderIds.map(String))) > 0) {
    throw new Error(`${name} still has a live SPP / PO on its SPKs: cancel it before removing the stage`);
  }
}

export const productionProcessService = new ProductionProcessService();
