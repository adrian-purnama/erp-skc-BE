import type {
  ProjectCloseReason,
  ProjectGender,
  ProjectLoseReason,
  ProjectStatus,
} from "../models/project.model";

export type ProjectCustomerContactDto = {
  name: string;
  gender: ProjectGender;
  contact: Record<string, string>;
};

export type CreateProjectDto = {
  name: string;
  description?: string;
  customerId: string;
  customerContact: ProjectCustomerContactDto;
  status?: ProjectStatus;
  loseReason?: ProjectLoseReason | null;
  closeReason?: ProjectCloseReason | null;
  plannedStartDate?: string | null;
  plannedFinishDate?: string | null;
};

export type UpdateProjectDto = {
  name?: string;
  description?: string;
  customerId?: string;
  customerContact?: ProjectCustomerContactDto;
  status?: ProjectStatus;
  loseReason?: ProjectLoseReason | null;
  closeReason?: ProjectCloseReason | null;
  isActive?: boolean;
  /** Sent together; null clears. */
  plannedStartDate?: string | null;
  plannedFinishDate?: string | null;
};

export type ProjectListItemOutDto = {
  id: string;
  name: string;
  description: string;
  customerId: string;
  customerName: string | null;
  projectNumber: string;
  status: ProjectStatus;
  loseReason: ProjectLoseReason | null;
  closeReason: ProjectCloseReason | null;
  isActive: boolean;
  /** ISO time the project was released to production, or null. */
  productionReleasedAt: string | null;
  /** Planned project dates (YYYY-MM-DD), or null. */
  plannedStartDate: string | null;
  plannedFinishDate: string | null;
};

/** Money/progress roll-up shown on the project list. Money is IDR digits. */
export type ProjectSummaryOutDto = {
  /** Won quotation grand total, else latest issued one; null if none. */
  contractValue: string | null;
  contractStatus: "won" | "issued" | null;
  /** Contract before tax minus RAB total; null when either is missing. */
  plannedMargin: string | null;
  /** RAB grand total (priced lines only); null when nothing is priced. */
  rabTotal: string | null;
  rabStatus: "draft" | "locked" | null;
  /** Posted purchase realizations on the project's POs. */
  actualCost: string;
  shopDrawingCount: number;
  /** Non-cancelled SPK qty vs non-voided reported qty. */
  productionOrderedQty: string;
  productionDoneQty: string;
  productionPercent: number;
  /**
   * The deadline the project is held to. Tender: calendar deadlines (next,
   * else the last past one). Won: planned finish, else latest SPK planned finish.
   */
  deadline: string | null;
  deadlineTitle: string | null;
  /** Next upcoming calendar deadline, or null. */
  nextMilestone: string | null;
  nextMilestoneTitle: string | null;
  /** Today's S-curve reading; null when the project has no schedule. */
  schedule: { plannedPct: number; actualPct: number; deviationPct: number } | null;
};

export type ProjectListRowOutDto = ProjectListItemOutDto & {
  createdAt: string | null;
  summary: ProjectSummaryOutDto;
};

export type ProjectDetailOutDto = ProjectListItemOutDto & {
  customerContact: ProjectCustomerContactDto;
};
