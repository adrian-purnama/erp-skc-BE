import { Types } from "mongoose";
import {
  deleteFileIfExists,
  findFile,
  readFileBuffer,
  uploadFile,
} from "../../buckets/gridfs";
import { withTx } from "../../core/audit/context";
import { env } from "../../environment/env";
import type { ProjectRabUserRefOutDto } from "../../dto/projectRab.dto";
import type {
  PatchProjectQuotationLineInDto,
  ProjectQuotationOutDto,
  ProjectQuotationOverviewOutDto,
  ProjectQuotationSummaryOutDto,
  PublicQuotationDocOutDto,
  PublicQuotationOutDto,
  UpdateProjectQuotationInDto,
} from "../../dto/projectQuotation.dto";
import { CustomerRepo } from "../../models/customer/customer.model";
import { ProjectRepo } from "../../models/project/project.model";
import {
  ProjectQuotationRepo,
  type ProjectQuotationContactSnapshot,
  type ProjectQuotationInterface,
  type ProjectQuotationLine,
} from "../../models/projectQuotation/projectQuotation.model";
import {
  ProjectRabRepo,
  type ProjectRabInterface,
} from "../../models/projectRab/projectRab.model";
import { ProjectShopDrawingBoqRepo } from "../../models/projectShopDrawingBoq/projectShopDrawingBoq.model";
import { ProjectShopDrawingDocumentRepo } from "../../models/projectShopDrawingDocument/projectShopDrawingDocument.model";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem/projectShopDrawingItem.model";
import { TermOfPaymentRepo } from "../../models/termOfPayment/termOfPayment.model";
import { UserModel } from "../../models/user/user.model";
import { logger } from "../../logger/logger";
import {
  addJakartaDays,
  jakartaYmdString,
  userEmailsById,
} from "../../utils/shared";
import { appConfigService } from "../appConfig/AppConfig.service";
import { projectRabChangeService } from "../project/projectRabChange.service";
import type { BoqLike } from "../project/projectRab.planner";
import { liveCurrentFiles } from "../project/projectCurrentFiles";
import { filterCountedBoqs } from "../project/projectRabChange.planner";
import { loadRabUomPlan } from "../project/projectRabUomPlan";
import type { QuotationLogo } from "./quotation.logo";
import {
  isVerifyTokenShape,
  newVerifyToken,
  verifyState,
} from "./quotation.access";
import {
  buildQuotationSections,
  buildSeedLines,
  computeTotals,
  lineTotal,
  quotationNumber,
  repriceLines,
  sellPriceFromCost,
  toRoman,
  type PlannerLine,
  type SeedBoq,
} from "./quotation.planner";

const LOGO_BUCKET = "quotation";
const PUBLIC_BUCKET = "public";
const logSource = "modules/quotation/quotation.service.ts";

/** Client-page failures carry the HTTP status the controller should send. */
export class QuotationAccessError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 404 | 410 | 429,
  ) {
    super(message);
  }
}

/** Issuing needs a full name for the "Hormat kami" signature. */
export class QuotationFullNameRequiredError extends Error {
  constructor() {
    super(
      "Full name is required to issue. You can change it in your profile (top right).",
    );
  }
}

/** New drafts start valid for this many days (editable before issuing). */
const DEFAULT_VALID_DAYS = 30;

function wonLockedMessage(won: { revision: number }): string {
  return `Quotation R${won.revision} is won: quotations for this project are locked`;
}

function verifyUrlFor(token: string): string {
  return `${env.frontendUrl.replace(/\/$/, "")}/q/${token}`;
}

type LeanQuotation = ProjectQuotationInterface & { _id: Types.ObjectId };
type LeanRab = ProjectRabInterface & { _id: Types.ObjectId };
type LeanProject = {
  _id: Types.ObjectId;
  projectNumber: string;
  customerId: Types.ObjectId;
  customerContact: {
    name?: string;
    gender?: string;
    contact?: Map<string, string> | Record<string, string>;
  };
};

/** Shop drawing item metadata shown on a quotation line. */
type LineItemMeta = {
  category: string | null;
  code: string;
  descriptions: string[];
  dimension: string;
};

const NO_ITEM_META: LineItemMeta = {
  category: null,
  code: "",
  descriptions: [],
  dimension: "",
};

type Snapshots = Pick<
  ProjectQuotationInterface,
  "company" | "customer" | "contact"
>;

function contactRecord(
  raw: Map<string, string> | Record<string, string> | undefined | null,
): Record<string, string> {
  if (!raw) return {};
  if (raw instanceof Map) return Object.fromEntries(raw.entries());
  return { ...raw };
}

/** Issued before logo capture: logoSourceId was never written (null means "no logo then"). */
function isLegacyIssued(doc: LeanQuotation): boolean {
  return doc.status !== "draft" && doc.company.logoSourceId === undefined;
}

function toPlannerLine(line: ProjectQuotationLine): PlannerLine {
  return {
    key: line.key,
    kind: line.kind,
    ...(line.shopDrawingItemId
      ? { shopDrawingItemId: String(line.shopDrawingItemId) }
      : {}),
    ...(line.shopDrawingFileId
      ? { shopDrawingFileId: String(line.shopDrawingFileId) }
      : {}),
    description: line.description,
    qty: line.qty,
    uom: line.uom,
    costUnitPrice: line.costUnitPrice,
    unitPrice: line.unitPrice,
    priceOverridden: line.priceOverridden === true,
  };
}

function fromPlannerLine(line: PlannerLine): ProjectQuotationLine {
  return {
    key: line.key,
    kind: line.kind,
    ...(line.shopDrawingItemId
      ? { shopDrawingItemId: new Types.ObjectId(line.shopDrawingItemId) }
      : {}),
    ...(line.shopDrawingFileId
      ? { shopDrawingFileId: new Types.ObjectId(line.shopDrawingFileId) }
      : {}),
    description: line.description,
    qty: line.qty,
    uom: line.uom,
    costUnitPrice: line.costUnitPrice,
    unitPrice: line.unitPrice,
    priceOverridden: line.priceOverridden,
  };
}

export class QuotationService {
  async overview(projectId: string): Promise<ProjectQuotationOverviewOutDto> {
    await this.requireProject(projectId);
    const gate = await this.rabGate(projectId);
    const docs = (await ProjectQuotationRepo.model
      .find({ projectId: new Types.ObjectId(projectId) })
      .sort({ revision: -1 })
      .lean()
      .exec()) as LeanQuotation[];

    const names = await this.userNames(docs);
    const hasDraft = docs.some((d) => d.status === "draft");
    const won = docs.find((d) => d.status === "won");
    return {
      projectId,
      rabStatus: gate.rab ? gate.rab.status : "none",
      rabChangeDraftOpen: gate.changeDraftOpen,
      currentRabRevision: gate.revision,
      createBlockedReason: won
        ? wonLockedMessage(won)
        : hasDraft
          ? "A draft revision is already open"
          : gate.blockedReason,
      revisions: docs.map((d) => this.toSummary(d, names)),
    };
  }

  async getById(id: string): Promise<ProjectQuotationOutDto | null> {
    const doc = await this.findById(id);
    if (!doc) return null;
    return this.toOut(await this.ensureVerifyToken(doc));
  }

  /**
   * Every issued (or superseded) quotation has a client link, including ones
   * issued before links existed. The access code is still created on demand.
   */
  private async ensureVerifyToken(doc: LeanQuotation): Promise<LeanQuotation> {
    if (doc.status === "draft" || doc.verifyToken) return doc;
    const updated = (await ProjectQuotationRepo.findOneAndUpdate(
      { _id: doc._id, verifyToken: { $exists: false } },
      { $set: { verifyToken: newVerifyToken() } },
    )) as LeanQuotation | null;
    return updated ?? ((await this.findById(String(doc._id))) as LeanQuotation);
  }

  /** Open a new draft revision seeded from the locked RAB. */
  async createDraft(
    projectId: string,
    userId: string,
  ): Promise<ProjectQuotationOutDto> {
    const project = await this.requireProject(projectId);
    if (!Types.ObjectId.isValid(userId)) throw new Error("Invalid user id");
    const gate = await this.rabGate(projectId);
    if (gate.blockedReason || !gate.rab) {
      throw new Error(gate.blockedReason ?? "RAB not found");
    }

    await this.assertNotWon(projectId);
    const projectOid = new Types.ObjectId(projectId);
    const existingDraft = await ProjectQuotationRepo.model
      .findOne({ projectId: projectOid, status: "draft" })
      .lean()
      .exec();
    if (existingDraft) {
      throw new Error("A draft revision is already open");
    }

    const latest = (await ProjectQuotationRepo.model
      .findOne({ projectId: projectOid })
      .sort({ revision: -1 })
      .lean()
      .exec()) as LeanQuotation | null;
    const base = latest?.status === "issued" ? latest : null;
    const revision = (latest?.revision ?? 0) + 1;

    const markupPercent = base?.markupPercent ?? "0";
    const seedBoqs = await this.loadSeedBoqs(projectId);
    const lines = buildSeedLines({
      boqs: seedBoqs,
      rabLines: gate.rab.lines.map((l) => ({
        key: l.key,
        totalQty: l.totalQty,
        exactQty: l.exactQty ?? null,
        unitPrice: l.unitPrice ?? null,
        origin: l.origin ?? null,
      })),
      markupPercent,
      previous: base?.lines.map(toPlannerLine),
      plan: await loadRabUomPlan(seedBoqs),
    });
    if (lines.length === 0) {
      throw new Error("Locked RAB has no shop drawing items to quote");
    }

    const snapshots = await this.loadSnapshots(project);
    const created = (await ProjectQuotationRepo.create({
      projectId: projectOid,
      revision,
      quotationNumber: quotationNumber(project.projectNumber, revision),
      status: "draft",
      rabRevision: gate.revision,
      subject: base?.subject ?? "",
      markupPercent,
      discountType: base?.discountType ?? "percent",
      discountValue: base?.discountValue ?? "0",
      taxPercent: base?.taxPercent ?? "11",
      validUntil: addJakartaDays(jakartaYmdString(), DEFAULT_VALID_DAYS),
      notes: base?.notes ?? "",
      termOfPaymentId: base?.termOfPaymentId ?? null,
      termOfPaymentText: base?.termOfPaymentText ?? "",
      ...snapshots,
      lines: lines.map(fromPlannerLine),
      createdBy: new Types.ObjectId(userId),
    })) as unknown as LeanQuotation;
    return this.toOut(created);
  }

  async update(
    id: string,
    input: UpdateProjectQuotationInDto,
  ): Promise<ProjectQuotationOutDto> {
    const doc = await this.requireDraft(id);
    const set: Partial<ProjectQuotationInterface> = {};

    if (input.subject !== undefined) set.subject = input.subject;
    if (input.discountType !== undefined) set.discountType = input.discountType;
    if (input.discountValue !== undefined) set.discountValue = input.discountValue;
    if (input.taxPercent !== undefined) set.taxPercent = input.taxPercent;
    if (input.validUntil !== undefined) set.validUntil = input.validUntil;
    if (input.notes !== undefined) set.notes = input.notes;
    if (input.markupPercent !== undefined) {
      set.markupPercent = input.markupPercent;
      set.lines = repriceLines(
        doc.lines.map(toPlannerLine),
        input.markupPercent,
      ).map(fromPlannerLine);
    }
    if (input.termOfPaymentId !== undefined) {
      if (input.termOfPaymentId === null) {
        set.termOfPaymentId = null;
        set.termOfPaymentText = "";
      } else {
        const top = await TermOfPaymentRepo.model
          .findById(input.termOfPaymentId)
          .lean()
          .exec();
        if (!top || top.isActive === false) {
          throw new Error("Term of payment must be an active master entry");
        }
        set.termOfPaymentId = top._id;
        set.termOfPaymentText = top.termOfPayment;
      }
    }

    return this.save(doc, set);
  }

  async patchLine(
    id: string,
    lineKey: string,
    input: PatchProjectQuotationLineInDto,
  ): Promise<ProjectQuotationOutDto> {
    const doc = await this.requireDraft(id);
    const idx = doc.lines.findIndex((l) => l.key === lineKey);
    if (idx < 0) throw new Error("Quotation line not found");

    const lines = doc.lines.map(toPlannerLine);
    const line = { ...lines[idx]! };
    if (input.description !== undefined) line.description = input.description;
    if (input.uom !== undefined) line.uom = input.uom;
    if (input.unitPrice !== undefined) {
      if (input.unitPrice === null) {
        line.unitPrice = sellPriceFromCost(line.costUnitPrice, doc.markupPercent);
        line.priceOverridden = false;
      } else {
        line.unitPrice = input.unitPrice;
        line.priceOverridden = true;
      }
    }
    lines[idx] = line;
    return this.save(doc, { lines: lines.map(fromPlannerLine) });
  }

  /** Re-seed lines from the current locked RAB, keeping user edits by key. */
  async resync(id: string): Promise<ProjectQuotationOutDto> {
    const doc = await this.requireDraft(id);
    const projectId = String(doc.projectId);
    const project = await this.requireProject(projectId);
    const gate = await this.rabGate(projectId);
    if (gate.blockedReason || !gate.rab) {
      throw new Error(gate.blockedReason ?? "RAB not found");
    }
    const seedBoqs = await this.loadSeedBoqs(projectId);
    const lines = buildSeedLines({
      boqs: seedBoqs,
      rabLines: gate.rab.lines.map((l) => ({
        key: l.key,
        totalQty: l.totalQty,
        exactQty: l.exactQty ?? null,
        unitPrice: l.unitPrice ?? null,
        origin: l.origin ?? null,
      })),
      markupPercent: doc.markupPercent,
      previous: doc.lines.map(toPlannerLine),
      plan: await loadRabUomPlan(seedBoqs),
    });
    return this.save(doc, {
      rabRevision: gate.revision,
      lines: lines.map(fromPlannerLine),
      ...(await this.loadSnapshots(project)),
    });
  }

  /** Freeze the draft: refresh letterhead/customer snapshots, supersede the previous issue. */
  async issue(id: string, userId: string): Promise<ProjectQuotationOutDto> {
    const doc = await this.requireDraft(id);
    if (!Types.ObjectId.isValid(userId)) throw new Error("Invalid user id");
    const projectId = String(doc.projectId);
    const project = await this.requireProject(projectId);
    await this.assertNotWon(projectId);
    const gate = await this.rabGate(projectId);
    if (gate.blockedReason) throw new Error(gate.blockedReason);
    if (gate.revision !== doc.rabRevision) {
      throw new Error(
        `RAB changed since this draft (rev ${doc.rabRevision} → ${gate.revision}); resync before issuing`,
      );
    }
    if (doc.lines.length === 0) throw new Error("Quotation has no lines");
    if (doc.lines.some((l) => !l.description.trim())) {
      throw new Error("Every line needs a description");
    }
    if (!doc.validUntil) {
      throw new Error("Set “Valid until” before issuing: the client link expires on that date");
    }
    if (doc.validUntil < jakartaYmdString()) {
      throw new Error("“Valid until” is in the past");
    }

    const issuedByName = await this.issuerFullName(userId);

    const metas = await this.lineItemMeta(doc);
    const lines = doc.lines.map((l, i) => ({ ...l, ...metas[i] }));

    const snapshots = await this.loadSnapshots(project);
    if (!snapshots.company.name) {
      throw new Error("Set the company name in Admin › Config before issuing");
    }
    const logo = await this.captureLogo();
    snapshots.company.logoFileId = logo?.fileId ?? null;
    snapshots.company.logoSourceId = logo?.sourceId ?? null;

    const verifyToken = newVerifyToken();

    const previous = await ProjectQuotationRepo.model
      .find({ projectId: doc.projectId, status: "issued" })
      .select({ _id: 1 })
      .lean()
      .exec();
    let issued: LeanQuotation | null;
    try {
      issued = await withTx(async () => {
      for (const row of previous) {
        await ProjectQuotationRepo.findOneAndUpdate(
          { _id: row._id, status: "issued" },
          { $set: { status: "superseded" } },
        );
      }
      return (await ProjectQuotationRepo.findOneAndUpdate(
        { _id: doc._id, status: "draft" },
        {
          $set: {
            status: "issued",
            issuedAt: new Date(),
            issuedBy: new Types.ObjectId(userId),
            issuedByName,
            lines,
            ...snapshots,
            verifyToken,
          },
        },
      )) as LeanQuotation | null;
      });
    } catch (error) {
      if (logo?.created) await deleteFileIfExists(LOGO_BUCKET, logo.fileId);
      throw error;
    }
    if (!issued) {
      if (logo?.created) await deleteFileIfExists(LOGO_BUCKET, logo.fileId);
      throw new Error("Failed to issue quotation");
    }
    return this.toOut(issued);
  }

  /**
   * Bring back a superseded revision as the issued one (e.g. the client
   * accepted an earlier offer). Its printed content and client link stay as
   * they were; only issue date, issuer and Valid until are refreshed.
   */
  async reissue(
    id: string,
    userId: string,
    validUntil: string,
  ): Promise<ProjectQuotationOutDto> {
    const doc = await this.findById(id);
    if (!doc) throw new Error("Quotation not found");
    if (doc.status !== "superseded") {
      throw new Error("Only a superseded revision can be re-issued");
    }
    await this.assertNotWon(String(doc.projectId));
    if (!Types.ObjectId.isValid(userId)) throw new Error("Invalid user id");
    if (validUntil < jakartaYmdString()) {
      throw new Error("“Valid until” is in the past");
    }
    const issuedByName = await this.issuerFullName(userId);

    const previous = await ProjectQuotationRepo.model
      .find({ projectId: doc.projectId, status: "issued" })
      .select({ _id: 1 })
      .lean()
      .exec();
    const reissued = await withTx(async () => {
      for (const row of previous) {
        await ProjectQuotationRepo.findOneAndUpdate(
          { _id: row._id, status: "issued" },
          { $set: { status: "superseded" } },
        );
      }
      return (await ProjectQuotationRepo.findOneAndUpdate(
        { _id: doc._id, status: "superseded" },
        {
          $set: {
            status: "issued",
            issuedAt: new Date(),
            issuedBy: new Types.ObjectId(userId),
            issuedByName,
            validUntil,
            ...(doc.verifyToken ? {} : { verifyToken: newVerifyToken() }),
          },
        },
      )) as LeanQuotation | null;
    });
    if (!reissued) throw new Error("Failed to re-issue quotation");
    return this.toOut(reissued);
  }

  /**
   * The client accepted this issued revision. Quotations for the project are
   * locked from here on (no new revision, no re-issue) and the project is a win.
   */
  async markWon(id: string, userId: string): Promise<ProjectQuotationOutDto> {
    const doc = await this.findById(id);
    if (!doc) throw new Error("Quotation not found");
    if (doc.status !== "issued") {
      throw new Error("Only the issued revision can be marked as won");
    }
    if (!Types.ObjectId.isValid(userId)) throw new Error("Invalid user id");
    await this.assertNotWon(String(doc.projectId));

    const won = await withTx(async () => {
      const updated = (await ProjectQuotationRepo.findOneAndUpdate(
        { _id: doc._id, status: "issued" },
        {
          $set: {
            status: "won",
            wonAt: new Date(),
            wonBy: new Types.ObjectId(userId),
          },
        },
      )) as LeanQuotation | null;
      if (!updated) throw new Error("Failed to mark quotation as won");
      await ProjectRepo.findByIdAndUpdate(String(doc.projectId), {
        $set: { status: "win", loseReason: null, closeReason: null },
      });
      return updated;
    });
    return this.toOut(won);
  }

  /** Undo "won" (back to issued) while the project is not yet in production. */
  async unmarkWon(id: string): Promise<ProjectQuotationOutDto> {
    const doc = await this.findById(id);
    if (!doc) throw new Error("Quotation not found");
    if (doc.status !== "won") throw new Error("Quotation is not marked as won");
    const project = await ProjectRepo.model
      .findById(doc.projectId)
      .select({ productionReleasedAt: 1 })
      .lean()
      .exec();
    if (project?.productionReleasedAt) {
      throw new Error(
        "Project is released to production: the won quotation cannot be undone",
      );
    }
    const reverted = (await ProjectQuotationRepo.findOneAndUpdate(
      { _id: doc._id, status: "won" },
      { $set: { status: "issued" }, $unset: { wonAt: 1, wonBy: 1 } },
    )) as LeanQuotation | null;
    if (!reverted) throw new Error("Failed to undo won");
    return this.toOut(reverted);
  }

  private async assertNotWon(projectId: string): Promise<void> {
    const won = (await ProjectQuotationRepo.model
      .findOne({ projectId: new Types.ObjectId(projectId), status: "won" })
      .lean()
      .exec()) as LeanQuotation | null;
    if (won) throw new Error(wonLockedMessage(won));
  }

  private async issuerFullName(userId: string): Promise<string> {
    const issuer = await UserModel.findById(userId)
      .select({ fullName: 1 })
      .lean()
      .exec();
    const name = issuer?.fullName?.trim() ?? "";
    if (!name) throw new QuotationFullNameRequiredError();
    return name;
  }

  /**
   * The client link: the unguessable token is the only credential. Shows the
   * quotation while it is the current issued revision and not past Valid until;
   * otherwise only why it cannot be shown (no prices).
   */
  async publicLookup(token: string): Promise<PublicQuotationOutDto> {
    const doc = await this.findByToken(token);
    if (!doc) {
      return {
        state: "unavailable",
        quotationNumber: null,
        companyName: null,
        validUntil: null,
        quotation: null,
      };
    }
    const state = verifyState({
      status: doc.status,
      validUntil: doc.validUntil,
      todayYmd: jakartaYmdString(),
    });
    return {
      state,
      quotationNumber: doc.quotationNumber,
      companyName: doc.company.name || null,
      validUntil: doc.validUntil ?? null,
      quotation: state === "valid" ? await this.toPublicDoc(doc) : null,
    };
  }

  /** The issued quotation behind a client link, only while it may be shown. */
  async requireValidByToken(token: string): Promise<LeanQuotation> {
    const doc = await this.findByToken(token);
    if (!doc) throw new QuotationAccessError("This link is not valid", 404);
    const state = verifyState({
      status: doc.status,
      validUntil: doc.validUntil,
      todayYmd: jakartaYmdString(),
    });
    if (state === "superseded") {
      throw new QuotationAccessError(
        "This quotation has been replaced by a newer revision. Please contact us for the latest one.",
        410,
      );
    }
    if (state !== "valid") {
      throw new QuotationAccessError(
        "This quotation has expired and can no longer be viewed. Please contact us for an updated quotation.",
        410,
      );
    }
    return doc;
  }

  private async toPublicDoc(doc: LeanQuotation): Promise<PublicQuotationDocOutDto> {
    const out = await this.toOut(doc);
    return {
        quotationNumber: out.quotationNumber,
        revision: out.revision,
        issuedAt: out.issuedAt,
        validUntil: out.validUntil,
        subject: out.subject,
        company: {
          name: out.company.name,
          npwp: out.company.npwp,
          address: out.company.address,
          phone: out.company.phone,
          email: out.company.email,
          website: out.company.website,
          branchOfficeAddresses: out.company.branchOfficeAddresses,
          hasLogo: out.company.hasLogo,
        },
        customer: { name: out.customer.name, address: out.customer.address },
        attention:
          `${out.contact.gender === "female" ? "Ibu" : "Bapak"} ${out.contact.name}`.trim(),
        lines: out.lines.map((l) => ({
          code: l.code,
          description: l.description,
          descriptions: l.descriptions,
          dimension: l.dimension,
          qty: l.qty,
          uom: l.uom,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        })),
        sections: out.sections,
        issuedByName: out.issuedByName,
        discountType: out.discountType,
        discountValue: out.discountValue,
        taxPercent: out.taxPercent,
        totals: {
          subtotal: out.totals.subtotal,
          discountAmount: out.totals.discountAmount,
          taxBase: out.totals.taxBase,
          taxAmount: out.totals.taxAmount,
          grandTotal: out.totals.grandTotal,
        },
        termOfPaymentText: out.termOfPaymentText,
        notes: out.notes,
    };
  }

  private async findByToken(token: string): Promise<LeanQuotation | null> {
    if (!isVerifyTokenShape(token)) return null;
    return (await ProjectQuotationRepo.model
      .findOne({ verifyToken: token })
      .lean()
      .exec()) as LeanQuotation | null;
  }

  async discardDraft(id: string): Promise<void> {
    const doc = await this.requireDraft(id);
    await ProjectQuotationRepo.deleteOne({ _id: doc._id, status: "draft" });
  }

  /** Issued: the captured copy. Draft: the live AppConfig company profile. */
  async loadLogo(doc: LeanQuotation): Promise<QuotationLogo | null> {
    if (isLegacyIssued(doc)) {
      doc = await this.backfillLogo(doc);
    }
    const issuedCopy = doc.company.logoFileId ?? null;
    const bucket = issuedCopy ? LOGO_BUCKET : PUBLIC_BUCKET;
    const id =
      issuedCopy ??
      (doc.status === "draft" ? appConfigService.companyProfile : null);
    if (!id) return null;
    try {
      const file = await findFile(bucket, id);
      if (!file) return null;
      const contentType =
        typeof file.metadata?.contentType === "string"
          ? file.metadata.contentType
          : "application/octet-stream";
      return { buffer: await readFileBuffer(bucket, id), contentType };
    } catch (error) {
      logger.warn(
        error instanceof Error ? error.message : String(error),
        logSource,
        "loadLogo",
      );
      return null;
    }
  }

  /**
   * Issued before logo capture existed: take the current company profile logo
   * once and store it on the quotation so later exports stay stable.
   */
  private async backfillLogo(doc: LeanQuotation): Promise<LeanQuotation> {
    const logo = await this.captureLogo();
    try {
      const updated = (await ProjectQuotationRepo.findOneAndUpdate(
        { _id: doc._id, "company.logoSourceId": { $exists: false } },
        {
          $set: {
            "company.logoFileId": logo?.fileId ?? null,
            "company.logoSourceId": logo?.sourceId ?? null,
          },
        },
      )) as LeanQuotation | null;
      if (!updated && logo?.created) {
        await deleteFileIfExists(LOGO_BUCKET, logo.fileId);
      }
      return (
        updated ?? ((await this.findById(String(doc._id))) as LeanQuotation)
      );
    } catch (error) {
      if (logo?.created) await deleteFileIfExists(LOGO_BUCKET, logo.fileId);
      throw error;
    }
  }

  /**
   * Copy the current company profile logo into the quotation bucket so later
   * AppConfig logo replacements (which delete the old file) keep old quotes intact.
   */
  private async captureLogo(): Promise<{
    fileId: Types.ObjectId;
    sourceId: Types.ObjectId;
    created: boolean;
  } | null> {
    const sourceId = appConfigService.companyProfile;
    if (!sourceId) return null;

    const existing = (await ProjectQuotationRepo.model
      .findOne({
        "company.logoSourceId": sourceId,
        "company.logoFileId": { $ne: null },
      })
      .select({ "company.logoFileId": 1 })
      .lean()
      .exec()) as { company?: { logoFileId?: Types.ObjectId | null } } | null;
    const reuse = existing?.company?.logoFileId;
    if (reuse && (await findFile(LOGO_BUCKET, reuse))) {
      return { fileId: reuse, sourceId, created: false };
    }

    const source = await findFile(PUBLIC_BUCKET, sourceId);
    if (!source) return null;
    const contentType =
      typeof source.metadata?.contentType === "string"
        ? source.metadata.contentType
        : "application/octet-stream";
    const uploaded = await uploadFile(LOGO_BUCKET, {
      buffer: await readFileBuffer(PUBLIC_BUCKET, sourceId),
      filename: source.filename,
      contentType,
      metadata: { kind: "companyLogo", sourceId },
    });
    return { fileId: uploaded.id, sourceId, created: true };
  }

  async findById(id: string): Promise<LeanQuotation | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return (await ProjectQuotationRepo.model
      .findById(id)
      .lean()
      .exec()) as LeanQuotation | null;
  }

  private async requireDraft(id: string): Promise<LeanQuotation> {
    const doc = await this.findById(id);
    if (!doc) throw new Error("Quotation not found");
    if (doc.status !== "draft") {
      throw new Error("Only a draft revision can be changed");
    }
    return doc;
  }

  private async save(
    doc: LeanQuotation,
    set: Partial<ProjectQuotationInterface>,
  ): Promise<ProjectQuotationOutDto> {
    const updated = (await ProjectQuotationRepo.findOneAndUpdate(
      { _id: doc._id, status: "draft" },
      { $set: set },
    )) as LeanQuotation | null;
    if (!updated) throw new Error("Failed to update quotation");
    return this.toOut(updated);
  }

  private async requireProject(projectId: string): Promise<LeanProject> {
    if (!Types.ObjectId.isValid(projectId)) throw new Error("Invalid project id");
    const project = (await ProjectRepo.model
      .findById(projectId)
      .select({ projectNumber: 1, customerId: 1, customerContact: 1 })
      .lean()
      .exec()) as LeanProject | null;
    if (!project) throw new Error("Project not found");
    return project;
  }

  private async rabGate(projectId: string): Promise<{
    rab: LeanRab | null;
    changeDraftOpen: boolean;
    revision: number;
    blockedReason: string | null;
  }> {
    const rab = (await ProjectRabRepo.model
      .findOne({ projectId: new Types.ObjectId(projectId) })
      .lean()
      .exec()) as LeanRab | null;
    const change = await projectRabChangeService.findOpenDraft(projectId);
    const revision =
      await projectRabChangeService.latestCommittedRevision(projectId);
    let blockedReason: string | null = null;
    if (!rab || rab.status !== "locked") {
      blockedReason = "Lock the RAB before creating a quotation";
    } else if (change) {
      blockedReason = "Commit or discard the open RAB change first";
    }
    return { rab, changeDraftOpen: Boolean(change), revision, blockedReason };
  }

  private async loadSeedBoqs(projectId: string): Promise<SeedBoq[]> {
    const allBoqs = (await ProjectShopDrawingBoqRepo.model
      .find({ projectId: new Types.ObjectId(projectId) })
      .lean()
      .exec()) as Array<
      BoqLike & {
        shopDrawingItemId: Types.ObjectId;
        shopDrawingFileId: Types.ObjectId;
      }
    >;
    // Same rule as the RAB: only each item's current file version is quoted.
    const boqs = filterCountedBoqs(allBoqs, await liveCurrentFiles(projectId));
    if (boqs.length === 0) return [];

    const [items, files] = await Promise.all([
      ProjectShopDrawingItemRepo.model
        .find({ _id: { $in: boqs.map((b) => b.shopDrawingItemId) } })
        .select({ code: 1, name: 1 })
        .lean()
        .exec(),
      ProjectShopDrawingDocumentRepo.model
        .find({ _id: { $in: boqs.map((b) => b.shopDrawingFileId) } })
        .select({ version: 1 })
        .lean()
        .exec(),
    ]);
    const itemById = new Map(items.map((i) => [String(i._id), i]));
    const versionById = new Map(files.map((f) => [String(f._id), f.version]));

    return boqs.map((b) => ({
      ...b,
      shopDrawingItemId: String(b.shopDrawingItemId),
      shopDrawingFileId: String(b.shopDrawingFileId),
      itemCode: itemById.get(String(b.shopDrawingItemId))?.code ?? "",
      itemName:
        itemById.get(String(b.shopDrawingItemId))?.name ?? "Shop drawing item",
      fileVersion: versionById.get(String(b.shopDrawingFileId)) ?? 1,
    }));
  }

  private async loadSnapshots(project: LeanProject): Promise<Snapshots> {
    const config = appConfigService.getAppConfig();
    const customer = await CustomerRepo.model
      .findById(project.customerId)
      .lean()
      .exec();
    if (!customer) throw new Error("Project customer not found");

    const raw = project.customerContact ?? {};
    const contact: ProjectQuotationContactSnapshot = {
      name: raw.name ?? "",
      gender: raw.gender === "female" ? "female" : "male",
      contact: contactRecord(raw.contact),
    };
    return {
      company: {
        name: config.companyName,
        npwp: config.npwp,
        address: config.address,
        phone: config.phone,
        email: config.email,
        website: config.website,
        branchOfficeAddresses: [...config.branchOfficeAddresses],
      },
      customer: {
        customerId: customer._id,
        name: customer.name,
        address: customer.address ?? "",
        npwp: customer.npwp ?? "",
      },
      contact,
    };
  }

  private async userNames(docs: LeanQuotation[]): Promise<Map<string, string>> {
    return userEmailsById(
      docs.flatMap((d) =>
        [d.createdBy, d.issuedBy, d.wonBy].filter(Boolean),
      ) as Types.ObjectId[],
    );
  }

  private toSummary(
    doc: LeanQuotation,
    names: Map<string, string>,
  ): ProjectQuotationSummaryOutDto {
    const userRef = (
      id: Types.ObjectId | undefined,
    ): ProjectRabUserRefOutDto | null =>
      id ? { id: String(id), name: names.get(String(id)) ?? String(id) } : null;
    const totals = computeTotals({
      lines: doc.lines,
      discountType: doc.discountType,
      discountValue: doc.discountValue,
      taxPercent: doc.taxPercent,
    });
    return {
      id: String(doc._id),
      projectId: String(doc.projectId),
      revision: doc.revision,
      quotationNumber: doc.quotationNumber,
      status: doc.status,
      rabRevision: doc.rabRevision,
      grandTotal: totals.grandTotal,
      createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
      createdBy: userRef(doc.createdBy),
      issuedAt: doc.issuedAt ? doc.issuedAt.toISOString() : null,
      issuedBy: userRef(doc.issuedBy),
      wonAt: doc.wonAt ? doc.wonAt.toISOString() : null,
      wonBy: userRef(doc.wonBy),
    };
  }

  /**
   * Issued: the snapshot on each line. Draft: each shop drawing item's current
   * category, kode, keterangan and ukuran.
   */
  private async lineItemMeta(doc: LeanQuotation): Promise<LineItemMeta[]> {
    if (doc.status !== "draft") {
      return doc.lines.map((l) => ({
        category: l.category ?? null,
        code: l.code ?? "",
        descriptions: l.descriptions ?? [],
        dimension: l.dimension ?? "",
      }));
    }
    const itemIds = doc.lines
      .map((l) => l.shopDrawingItemId)
      .filter((id): id is Types.ObjectId => Boolean(id));
    if (itemIds.length === 0) return doc.lines.map(() => NO_ITEM_META);
    const items = await ProjectShopDrawingItemRepo.model
      .find({ _id: { $in: itemIds } })
      .select({ category: 1, code: 1, descriptions: 1, dimension: 1 })
      .lean()
      .exec();
    const byId = new Map(
      items.map((i): [string, LineItemMeta] => [
        String(i._id),
        {
          category: i.category ?? null,
          code: i.code ?? "",
          descriptions: i.descriptions ?? [],
          dimension: i.dimension ?? "",
        },
      ]),
    );
    return doc.lines.map((l) =>
      l.shopDrawingItemId
        ? (byId.get(String(l.shopDrawingItemId)) ?? NO_ITEM_META)
        : NO_ITEM_META,
    );
  }

  private async toOut(doc: LeanQuotation): Promise<ProjectQuotationOutDto> {
    const names = await this.userNames([doc]);
    const metas = await this.lineItemMeta(doc);
    const rabOutdated =
      doc.status === "draft" &&
      (await projectRabChangeService.latestCommittedRevision(
        String(doc.projectId),
      )) !== doc.rabRevision;

    return {
      ...this.toSummary(doc, names),
      subject: doc.subject ?? "",
      markupPercent: doc.markupPercent,
      discountType: doc.discountType,
      discountValue: doc.discountValue,
      taxPercent: doc.taxPercent,
      validUntil: doc.validUntil ?? null,
      notes: doc.notes ?? "",
      termOfPaymentId: doc.termOfPaymentId ? String(doc.termOfPaymentId) : null,
      termOfPaymentText: doc.termOfPaymentText ?? "",
      company: {
        name: doc.company.name,
        npwp: doc.company.npwp,
        address: doc.company.address,
        phone: doc.company.phone,
        email: doc.company.email,
        website: doc.company.website,
        branchOfficeAddresses: doc.company.branchOfficeAddresses ?? [],
        hasLogo:
          doc.status === "draft" || isLegacyIssued(doc)
            ? Boolean(appConfigService.companyProfile)
            : Boolean(doc.company.logoFileId),
      },
      customer: {
        customerId: String(doc.customer.customerId),
        name: doc.customer.name,
        address: doc.customer.address ?? "",
        npwp: doc.customer.npwp ?? "",
      },
      contact: {
        name: doc.contact.name,
        gender: doc.contact.gender,
        contact: contactRecord(doc.contact.contact),
      },
      lines: doc.lines.map((l, i) => ({
        key: l.key,
        kind: l.kind,
        shopDrawingItemId: l.shopDrawingItemId ? String(l.shopDrawingItemId) : null,
        shopDrawingFileId: l.shopDrawingFileId ? String(l.shopDrawingFileId) : null,
        description: l.description,
        qty: l.qty,
        uom: l.uom,
        costUnitPrice: l.costUnitPrice,
        unitPrice: l.unitPrice,
        priceOverridden: l.priceOverridden === true,
        lineTotal: lineTotal(l),
        ...(metas[i] ?? NO_ITEM_META),
      })),
      sections: buildQuotationSections(
        doc.lines.map((l, i) => ({ ...l, category: metas[i]?.category ?? null })),
      ).map((s, i) => ({ ...s, numeral: toRoman(i + 1) })),
      issuedByName:
        doc.status === "draft" ? null : doc.issuedByName?.trim() || null,
      totals: computeTotals({
        lines: doc.lines,
        discountType: doc.discountType,
        discountValue: doc.discountValue,
        taxPercent: doc.taxPercent,
      }),
      rabOutdated,
      verifyUrl:
        doc.verifyToken && doc.status !== "draft"
          ? verifyUrlFor(doc.verifyToken)
          : null,
      verifyState: doc.verifyToken
        ? verifyState({
            status: doc.status,
            validUntil: doc.validUntil,
            todayYmd: jakartaYmdString(),
          })
        : "unavailable",
    };
  }
}

export const quotationService = new QuotationService();
