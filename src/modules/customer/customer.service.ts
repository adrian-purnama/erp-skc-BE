import { Types } from "mongoose";
import type {
  CreateCustomerDto,
  CustomerDetailOutDto,
  CustomerListItemOutDto,
  UpdateCustomerDto,
} from "../../dto/customer.dto";
import { CustomerRepo } from "../../models/customer/customer.model";
import { escapeRegex } from "../../utils/shared";
import { emailService } from "../email/email.service";
import { phoneService } from "../phone/phone.service";

export class CustomerService {
  async list(q?: string): Promise<CustomerListItemOutDto[]> {
    return this.listFiltered(q, false);
  }

  /** Active customers only — for pickers in other modules. */
  async listActive(q?: string): Promise<CustomerListItemOutDto[]> {
    return this.listFiltered(q, true);
  }

  private async listFiltered(
    q: string | undefined,
    activeOnly: boolean,
  ): Promise<CustomerListItemOutDto[]> {
    const filter: Record<string, unknown> = {};
    if (q && q.trim()) {
      filter.name = { $regex: escapeRegex(q.trim()), $options: "i" };
    }
    if (activeOnly) filter.isActive = { $ne: false };
    const docs = await CustomerRepo.model
      .find(filter)
      .sort({ name: 1 })
      .lean()
      .exec();
    return docs.map((doc) => ({
      id: String(doc._id),
      name: doc.name,
      address: doc.address,
      npwp: doc.npwp ?? "",
      isActive: doc.isActive !== false,
    }));
  }

  async getById(id: string): Promise<CustomerDetailOutDto | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await CustomerRepo.model.findById(id).lean().exec();
    if (!doc) return null;
    const [emails, phones] = await Promise.all([
      emailService.listByOwner(id),
      phoneService.listByOwner(id),
    ]);
    return {
      id: String(doc._id),
      name: doc.name,
      address: doc.address,
      npwp: doc.npwp ?? "",
      isActive: doc.isActive !== false,
      emails: emails.map((e) => ({
        id: e.id,
        address: e.address,
        type: e.type,
        isPreferred: e.isPreferred,
      })),
      phones: phones.map((p) => ({
        id: p.id,
        number: p.number,
        type: p.type,
        isPreferred: p.isPreferred,
      })),
    };
  }

  async create(input: CreateCustomerDto): Promise<CustomerDetailOutDto> {
    const created = await CustomerRepo.create({
      name: input.name.toUpperCase(),
      address: input.address ?? "",
      npwp: input.npwp ?? "",
      isActive: true,
    });
    const id = String(created._id);
    await emailService.replaceForOwner(id, input.emails ?? []);
    await phoneService.replaceForOwner(id, input.phones ?? []);
    const detail = await this.getById(id);
    if (!detail) throw new Error("Customer created but not found");
    return detail;
  }

  async update(
    id: string,
    patch: UpdateCustomerDto,
  ): Promise<CustomerDetailOutDto> {
    if (!Types.ObjectId.isValid(id)) throw new Error("Invalid customer id");

    const existing = await CustomerRepo.model.findById(id).lean().exec();
    if (!existing) throw new Error("Customer not found");

    if (
      patch.name !== undefined ||
      patch.address !== undefined ||
      patch.npwp !== undefined ||
      patch.isActive !== undefined
    ) {
      const updated = await CustomerRepo.findByIdAndUpdate(
        id,
        {
          $set: {
            ...(patch.name !== undefined
              ? { name: patch.name.toUpperCase() }
              : {}),
            ...(patch.address !== undefined ? { address: patch.address } : {}),
            ...(patch.npwp !== undefined ? { npwp: patch.npwp } : {}),
            ...(patch.isActive !== undefined
              ? { isActive: patch.isActive }
              : {}),
          },
        },
        { new: true },
      );
      if (!updated) throw new Error("Customer not found");
    }

    if (patch.emails !== undefined) {
      await emailService.replaceForOwner(id, patch.emails);
    }
    if (patch.phones !== undefined) {
      await phoneService.replaceForOwner(id, patch.phones);
    }

    const detail = await this.getById(id);
    if (!detail) throw new Error("Customer not found");
    return detail;
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new Error("Invalid customer id");
    const deleted = await CustomerRepo.deleteOne({ _id: id });
    if (!deleted) throw new Error("Customer not found");
    await emailService.deleteByOwner(id);
    await phoneService.deleteByOwner(id);
  }
}

export const customerService = new CustomerService();
