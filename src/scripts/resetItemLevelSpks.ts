/**
 * One-off dev reset for the move to SPK per RAB labour line: lists the old
 * item-level SPKs (no labour line) and what hangs off them. With --apply it
 * deletes them plus their reports, handovers and surat jalan, and clears
 * their link on SPPs / PO lines (those stay for purchasing to sort out).
 *
 *   npx tsx --env-file=.env src/scripts/resetItemLevelSpks.ts          # dry run
 *   npx tsx --env-file=.env src/scripts/resetItemLevelSpks.ts --apply
 */
import mongoose from "mongoose";
import { connectDatabase } from "../core/database";
import { env } from "../core/env";
import { MaterialDispatchRepo } from "../models/materialDispatch.model";
import { ProductionHandoverRepo } from "../models/productionHandover.model";
import { ProductionOrderRepo } from "../models/productionOrder.model";
import { ProductionReportRepo } from "../models/productionReport.model";
import { PurchaseOrderRepo } from "../models/purchaseOrder.model";
import { PurchaseRequestRepo } from "../models/purchaseRequest.model";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await connectDatabase(env.mongodbUrl, env.build);

  const old = await ProductionOrderRepo.model
    .find({ labourItemId: { $exists: false } })
    .select({ number: 1, status: 1 })
    .lean()
    .exec();
  const ids = old.map((o) => o._id);
  const [reports, handovers, dispatches, requests, purchaseOrders] = await Promise.all([
    ProductionReportRepo.model.countDocuments({ productionOrderId: { $in: ids } }).exec(),
    ProductionHandoverRepo.model.countDocuments({ productionOrderId: { $in: ids } }).exec(),
    MaterialDispatchRepo.model.countDocuments({ productionOrderId: { $in: ids } }).exec(),
    PurchaseRequestRepo.model.countDocuments({ productionOrderId: { $in: ids } }).exec(),
    PurchaseOrderRepo.model.countDocuments({ "lines.productionOrderId": { $in: ids } }).exec(),
  ]);
  console.log(`Item-level SPKs: ${old.length}`);
  for (const o of old) console.log(`  ${o.number} (${o.status})`);
  console.log(
    `Reports ${reports} · handovers ${handovers} · surat jalan ${dispatches} · SPP ${requests} · PO ${purchaseOrders}`,
  );

  if (!apply) {
    console.log("Dry run: nothing changed. Re-run with --apply to reset.");
  } else if (ids.length > 0) {
    await ProductionReportRepo.model.deleteMany({ productionOrderId: { $in: ids } }).exec();
    await ProductionHandoverRepo.model.deleteMany({ productionOrderId: { $in: ids } }).exec();
    await MaterialDispatchRepo.model.deleteMany({ productionOrderId: { $in: ids } }).exec();
    await PurchaseRequestRepo.model
      .updateMany({ productionOrderId: { $in: ids } }, { $unset: { productionOrderId: "" } })
      .exec();
    await PurchaseOrderRepo.model
      .updateMany(
        { "lines.productionOrderId": { $in: ids } },
        { $unset: { "lines.$[l].productionOrderId": "" } },
        { arrayFilters: [{ "l.productionOrderId": { $in: ids } }] },
      )
      .exec();
    await ProductionOrderRepo.model.deleteMany({ _id: { $in: ids } }).exec();
    console.log("Reset done.");
  }
  await mongoose.disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
