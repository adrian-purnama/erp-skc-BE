import type {
  ShrinkOrphanReport,
  ShrinkRunResult,
  ShrinkRunStatus,
  ShrinkSection,
} from "../models/shrinkRun/shrinkRun.model";

export type { ShrinkSection };

export type StartShrinkDbInDto = {
  section: ShrinkSection;
  excludedProjectIds: string[];
};

export type StartShrinkDbOutDto = {
  jobId: string;
};

export type ShrinkDbStep =
  | "idle"
  | "audit"
  | "documents"
  | "shopDrawings"
  | "finalize";

export type ShrinkLiveStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "interrupted";

export type ShrinkDbStatusOutDto = {
  jobId: string | null;
  status: ShrinkLiveStatus;
  section: ShrinkSection | null;
  step: ShrinkDbStep;
  processed: number;
  total: number;
  percent: number;
  excludedProjectIds: string[];
  result: ShrinkRunResult | null;
  errorMessage: string | null;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  /** Present when status comes from persisted ShrinkRun (memory idle). */
  persistedStatus?: ShrinkRunStatus;
};

export type ShrinkOrphansOutDto = ShrinkOrphanReport;

export type PurgeOrphanBlobsInDto = {
  gridFsIds: string[];
};

export type PurgeOrphanBlobsOutDto = {
  deleted: number;
  skipped: number;
};
