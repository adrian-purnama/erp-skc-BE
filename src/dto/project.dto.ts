import type {
  ProjectCloseReason,
  ProjectGender,
  ProjectLoseReason,
  ProjectStatus,
} from "../models/project/project.model";

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
};

export type ProjectDetailOutDto = ProjectListItemOutDto & {
  customerContact: ProjectCustomerContactDto;
};
