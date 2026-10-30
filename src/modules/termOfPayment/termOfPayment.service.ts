import { Types } from "mongoose";
import type {
  CreateTermOfPaymentDto,
  TermOfPaymentOutDto,
  UpdateTermOfPaymentDto,
} from "../../dto/termOfPayment.dto";
import {
  TermOfPaymentRepo,
  type TermOfPaymentInterface,
} from "../../models/termOfPayment.model";

type TermOfPaymentLean = TermOfPaymentInterface & { _id: Types.ObjectId };

const TERM_COLLATION = { locale: "en", strength: 2 } as const;

function toOut(doc: TermOfPaymentLean): TermOfPaymentOutDto {
  return {
    id: String(doc._id),
    termOfPayment: doc.termOfPayment,
    isActive: doc.isActive !== false,
  };
}

export class TermOfPaymentService {
  async list(): Promise<TermOfPaymentOutDto[]> {
    const docs = await TermOfPaymentRepo.model
      .find({})
      .sort({ termOfPayment: 1 })
      .lean()
      .exec();
    return docs.map((doc) => toOut(doc as TermOfPaymentLean));
  }

  async getById(id: string): Promise<TermOfPaymentOutDto | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await TermOfPaymentRepo.model.findById(id).lean().exec();
    if (!doc) return null;
    return toOut(doc as TermOfPaymentLean);
  }

  private async assertUniqueTerm(
    termOfPayment: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await TermOfPaymentRepo.model
      .findOne({ termOfPayment })
      .collation(TERM_COLLATION)
      .lean()
      .exec();
    if (!existing) return;
    if (excludeId && String(existing._id) === excludeId) return;
    throw new Error(`Term of payment "${termOfPayment}" already exists`);
  }

  async create(input: CreateTermOfPaymentDto): Promise<TermOfPaymentOutDto> {
    await this.assertUniqueTerm(input.termOfPayment);
    const created = await TermOfPaymentRepo.create({
      termOfPayment: input.termOfPayment,
      isActive: true,
    });
    const detail = await this.getById(String(created._id));
    if (!detail) throw new Error("Term of payment created but not found");
    return detail;
  }

  async update(
    id: string,
    input: UpdateTermOfPaymentDto,
  ): Promise<TermOfPaymentOutDto> {
    if (!Types.ObjectId.isValid(id)) throw new Error("Invalid term of payment id");
    const existing = await TermOfPaymentRepo.model.findById(id).lean().exec();
    if (!existing) throw new Error("Term of payment not found");

    if (input.termOfPayment !== undefined) {
      await this.assertUniqueTerm(input.termOfPayment, id);
    }

    const updated = await TermOfPaymentRepo.findByIdAndUpdate(
      id,
      {
        $set: {
          ...(input.termOfPayment !== undefined
            ? { termOfPayment: input.termOfPayment }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      },
      { new: true },
    );
    if (!updated) throw new Error("Term of payment not found");

    const detail = await this.getById(id);
    if (!detail) throw new Error("Term of payment not found");
    return detail;
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new Error("Invalid term of payment id");
    const deleted = await TermOfPaymentRepo.deleteOne({ _id: id });
    if (!deleted) throw new Error("Term of payment not found");
  }
}

export const termOfPaymentService = new TermOfPaymentService();
