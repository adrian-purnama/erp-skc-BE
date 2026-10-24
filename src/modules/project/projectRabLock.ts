import { Types } from "mongoose";
import { ProjectRabRepo } from "../../models/projectRab/projectRab.model";
import {
  projectRabChangeService,
  type LeanRabChange,
} from "./projectRabChange.service";

export type RabLockState = {
  locked: boolean;
  change: LeanRabChange | null;
};

export async function rabLocked(projectId: string): Promise<boolean> {
  const rab = await ProjectRabRepo.model
    .findOne({ projectId: new Types.ObjectId(projectId) })
    .select({ status: 1 })
    .lean()
    .exec();
  return rab?.status === "locked";
}

/** RAB lock flag plus the open change draft, if any. */
export async function rabLockState(projectId: string): Promise<RabLockState> {
  const locked = await rabLocked(projectId);
  const change = locked
    ? await projectRabChangeService.findOpenDraft(projectId)
    : null;
  return { locked, change };
}
