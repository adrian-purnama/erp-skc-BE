import type {
  ProjectRabChangeBoqDiffOutDto,
  ProjectRabChangeBoqMaterialDiffOutDto,
  ProjectRabChangeVersionDiffOutDto,
  ProjectRabLineOutDto,
  ProjectRabUserRefOutDto,
} from "./projectRab.dto";

export type {
  ProjectRabChangeBoqDiffOutDto,
  ProjectRabChangeBoqMaterialDiffOutDto,
  ProjectRabChangeVersionDiffOutDto,
} from "./projectRab.dto";

export type OpenProjectRabChangeInDto = {
  reason: string;
};

export type ProjectRabChangeSummaryOutDto = {
  id: string;
  projectId: string;
  reason: string;
  status: "draft" | "committed" | "discarded";
  openedAt: string;
  openedBy: ProjectRabUserRefOutDto;
  committedAt: string | null;
  committedBy: ProjectRabUserRefOutDto | null;
  /** Present when status is committed. */
  revision: number | null;
};

export type ProjectRabChangeLineDiffOutDto = {
  key: string;
  kind: "added" | "removed" | "changed";
  materialItemId: string | null;
  materialCode: string | null;
  materialName: string | null;
  uomSymbol: string | null;
  oldTotalQty: string | null;
  newTotalQty: string | null;
  oldUnitPrice: string | null;
  newUnitPrice: string | null;
};


export type ProjectRabChangeDetailOutDto = ProjectRabChangeSummaryOutDto & {
  lineDiff: ProjectRabChangeLineDiffOutDto[];
  boqDiff: ProjectRabChangeBoqDiffOutDto[];
  /** Items whose counted (current) file version was switched. */
  versionDiff: ProjectRabChangeVersionDiffOutDto[];
  /** Material qty changes scoped to a shop-drawing file (for elaboration). */
  boqMaterialDiff: ProjectRabChangeBoqMaterialDiffOutDto[];
  baselineGrandTotal: string | null;
  grandTotal: string | null;
  /** Draft/committed line snapshot (priced display optional). */
  lines: ProjectRabLineOutDto[];
};

/** First lock of the RAB: who locked it and the lines that existed then. */
export type ProjectRabLockOriginOutDto = {
  lockedAt: string;
  lockedBy: ProjectRabUserRefOutDto;
  grandTotal: string | null;
  lines: ProjectRabChangeLineDiffOutDto[];
};
