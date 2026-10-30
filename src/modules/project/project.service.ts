import { Types } from "mongoose";
import { withTx } from "../../core/audit/context";
import type {
  CreateProjectDto,
  ProjectCustomerContactDto,
  ProjectDetailOutDto,
  ProjectListItemOutDto,
  ProjectListRowOutDto,
  UpdateProjectDto,
} from "../../dto/project.dto";
import { CustomerRepo } from "../../models/customer.model";
import {
  ProjectRepo,
  type ProjectCloseReason,
  type ProjectLoseReason,
  type ProjectStatus,
} from "../../models/project.model";
import { escapeRegex } from "../../utils/shared";
import { allocateProjectNumber } from "./projectNumber";
import { assertProjectExists } from "./projectShared";
import { summarizeProjects } from "./projectSummary.service";

function contactToRecord(
  contact: Map<string, string> | Record<string, string> | undefined | null,
): Record<string, string> {
  if (!contact) return {};
  if (contact instanceof Map) {
    return Object.fromEntries(contact.entries());
  }
  return { ...contact };
}

function toContactOut(raw: unknown): ProjectCustomerContactDto {
  const row = raw as {
    name?: string;
    gender?: string;
    contact?: Map<string, string> | Record<string, string>;
  };
  return {
    name: row.name ?? "",
    gender: (row.gender === "female" ? "female" : "male") as
      | "male"
      | "female",
    contact: contactToRecord(row.contact),
  };
}

type LeanProject = {
  _id: Types.ObjectId;
  name: string;
  description: string;
  customerId: Types.ObjectId;
  projectNumber: string;
  customerContact: unknown;
  status?: ProjectStatus;
  loseReason?: ProjectLoseReason | null;
  closeReason?: ProjectCloseReason | null;
  isActive?: boolean;
  productionReleasedAt?: Date | null;
  createdAt?: Date;
};

function normalizeStatus(doc: LeanProject): {
  status: ProjectStatus;
  loseReason: ProjectLoseReason | null;
  closeReason: ProjectCloseReason | null;
} {
  const status = doc.status ?? "open";
  if (status === "lose") {
    return {
      status,
      loseReason: doc.loseReason ?? null,
      closeReason: null,
    };
  }
  if (status === "close") {
    return {
      status,
      loseReason: null,
      closeReason: doc.closeReason ?? null,
    };
  }
  return { status, loseReason: null, closeReason: null };
}

export class ProjectService {
  private async customerNameById(
    customerId: string,
  ): Promise<string | null> {
    if (!Types.ObjectId.isValid(customerId)) return null;
    const doc = await CustomerRepo.model
      .findById(customerId)
      .select({ name: 1 })
      .lean()
      .exec();
    return doc ? doc.name : null;
  }

  private async assertCustomerExists(customerId: string): Promise<void> {
    if (!Types.ObjectId.isValid(customerId)) {
      throw new Error("Invalid customerId");
    }
    const doc = await CustomerRepo.model.findById(customerId).lean().exec();
    if (!doc) throw new Error("Customer not found");
  }

  private toListItem(
    doc: LeanProject,
    customerName: string | null,
  ): ProjectListItemOutDto {
    const statusFields = normalizeStatus(doc);
    return {
      id: String(doc._id),
      name: doc.name,
      description: doc.description ?? "",
      customerId: String(doc.customerId),
      customerName,
      projectNumber: doc.projectNumber,
      status: statusFields.status,
      loseReason: statusFields.loseReason,
      closeReason: statusFields.closeReason,
      isActive: doc.isActive !== false,
      productionReleasedAt: doc.productionReleasedAt
        ? doc.productionReleasedAt.toISOString()
        : null,
    };
  }

  private toDetail(
    doc: LeanProject,
    customerName: string | null,
  ): ProjectDetailOutDto {
    return {
      ...this.toListItem(doc, customerName),
      customerContact: toContactOut(doc.customerContact),
    };
  }

  async list(q?: string): Promise<ProjectListRowOutDto[]> {
    const filter: Record<string, unknown> = {};
    if (q && q.trim()) {
      const rx = escapeRegex(q.trim());

      filter.$or = [
        { name: { $regex: rx, $options: "i" } },
        { projectNumber: { $regex: rx, $options: "i" } },
      ];
    }
    const docs = (await ProjectRepo.model
      .find(filter)
      .sort({ createdAt: -1 })
      .lean()
      .exec()) as LeanProject[];

    const customerIds = [
      ...new Set(docs.map((d) => String(d.customerId))),
    ];
    const customers = await CustomerRepo.model
      .find({ _id: { $in: customerIds } })
      .select({ name: 1 })
      .lean()
      .exec();
    const nameById = new Map(
      customers.map((c) => [String(c._id), c.name] as const),
    );

    const summaries = await summarizeProjects(docs.map((d) => String(d._id)));

    return docs.map((doc) => ({
      ...this.toListItem(doc, nameById.get(String(doc.customerId)) ?? null),
      createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
      summary: summaries.get(String(doc._id))!,
    }));
  }

  async getById(id: string): Promise<ProjectDetailOutDto | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = (await ProjectRepo.model
      .findById(id)
      .lean()
      .exec()) as LeanProject | null;
    if (!doc) return null;
    const customerName = await this.customerNameById(String(doc.customerId));
    return this.toDetail(doc, customerName);
  }

  async create(input: CreateProjectDto): Promise<ProjectDetailOutDto> {
    await this.assertCustomerExists(input.customerId);

    const created = await withTx(async (session) => {
      const projectNumber = await allocateProjectNumber({ session });
      return ProjectRepo.create({
        name: input.name,
        description: input.description ?? "",
        customerId: new Types.ObjectId(input.customerId),
        projectNumber,
        customerContact: {
          name: input.customerContact.name,
          gender: input.customerContact.gender,
          contact: input.customerContact.contact,
        },
        status: input.status ?? "open",
        loseReason: input.loseReason ?? null,
        closeReason: input.closeReason ?? null,
        isActive: true,
      });
    });

    const detail = await this.getById(String(created._id));
    if (!detail) throw new Error("Project created but not found");
    return detail;
  }

  async update(
    id: string,
    patch: UpdateProjectDto,
  ): Promise<ProjectDetailOutDto> {
    await assertProjectExists(id);

    if (patch.customerId !== undefined) {
      await this.assertCustomerExists(patch.customerId);
    }
    if (patch.status === "open" || patch.status === "lose") {
      const current = await ProjectRepo.model
        .findById(id)
        .select({ productionReleasedAt: 1 })
        .lean()
        .exec();
      if (current?.productionReleasedAt) {
        throw new Error(
          "Project is released to production: status cannot go back to open or lose",
        );
      }
    }

    const updated = await ProjectRepo.findByIdAndUpdate(id, {
      $set: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.customerId !== undefined
          ? { customerId: new Types.ObjectId(patch.customerId) }
          : {}),
        ...(patch.customerContact !== undefined
          ? { customerContact: patch.customerContact }
          : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.loseReason !== undefined
          ? { loseReason: patch.loseReason }
          : {}),
        ...(patch.closeReason !== undefined
          ? { closeReason: patch.closeReason }
          : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
    });
    if (!updated) throw new Error("Project not found");

    const detail = await this.getById(id);
    if (!detail) throw new Error("Project updated but not found");
    return detail;
  }

  async remove(id: string): Promise<void> {
    await assertProjectExists(id);
    const deleted = await ProjectRepo.deleteOne({ _id: id });
    if (!deleted) throw new Error("Project not found");
  }
}

export const projectService = new ProjectService();
