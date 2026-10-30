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
  /** Next upcoming calendar deadline, else the latest past one, else SPK planned finish. */
  deadline: string | null;
  deadlineTitle: string | null;
};

export type ProjectListRowOutDto = ProjectListItemOutDto & {
  createdAt: string | null;
  summary: ProjectSummaryOutDto;
};

export type ProjectDetailOutDto = ProjectListItemOutDto & {
  customerContact: ProjectCustomerContactDto;
};
