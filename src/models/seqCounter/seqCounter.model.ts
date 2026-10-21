import mongoose, { Schema, type Model } from "mongoose";

export interface SeqCounterInterface {
  scopeKey: string;
  nextSeq: number;
}

export function createSeqCounterModel(name: string): Model<SeqCounterInterface> {
  return (
    (mongoose.models[name] as Model<SeqCounterInterface> | undefined) ??
    mongoose.model<SeqCounterInterface>(
      name,
      new Schema<SeqCounterInterface>(
        {
          scopeKey: { type: String, required: true, unique: true },
          nextSeq: { type: Number, required: true, default: 0, min: 0 },
        },
        { timestamps: false },
      ),
    )
  );
}

export const ItemSeqCounterModel = createSeqCounterModel("ItemSeqCounter");
export const ProjectSeqCounterModel = createSeqCounterModel("ProjectSeqCounter");
