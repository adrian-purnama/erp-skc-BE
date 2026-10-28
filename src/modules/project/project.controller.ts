import type { Request, Response } from "express";
import { fail, handle, ok } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import { queryBool, queryString } from "../../validation/query";
import {
  parseCreateProjectDto,
  parseUpdateProjectDto,
} from "../../validation/project";
import {
  parseCreateProjectCalendarEventDto,
  parseNearDays,
  parseUpdateProjectCalendarEventDto,
} from "../../validation/projectCalendar";
import {
  parseProjectDocumentKind,
  parseRenameProjectFileDto,
} from "../../validation/projectDocument";
import {
  parseCreateShopDrawingItemDto,
  parseRenameShopDrawingItemDto,
} from "../../validation/projectShopDrawing";
import { parseUpsertShopDrawingBoqDto } from "../../validation/projectShopDrawingBoq";
import {
  parseAddProjectRabLabourLineDto,
  parsePatchProjectRabLineDto,
  parseRabLineKey,
} from "../../validation/projectRab";
import { parseOpenProjectRabChangeDto } from "../../validation/projectRabChange";
import { parseProjectLooseFileKind } from "../../validation/projectLooseFile";
import { projectCalendarService } from "./projectCalendar.service";
import { projectDocumentService } from "./projectDocument.service";
import { projectRabChangeService } from "./projectRabChange.service";
import {
  projectRabExportService,
  type RabExportKind,
} from "./projectRabExport.service";
import { projectRabService } from "./projectRab.service";
import { projectShopDrawingBoqService } from "./projectShopDrawingBoq.service";
import { projectShopDrawingService } from "./projectShopDrawing.service";
import { projectLooseFileService } from "./projectLooseFile.service";
import { projectService } from "./project.service";

async function streamDownload(
  res: Response,
  open: () => Promise<{
    stream: NodeJS.ReadableStream;
    filename: string;
    contentType: string;
  }>,
  fallback: string,
): Promise<void> {
  try {
    const { stream, filename, contentType } = await open();
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename.replace(/"/g, "")}"`,
    );
    stream.on("error", () => {
      if (!res.headersSent) {
        fail(res, null, fallback);
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (error) {
    fail(res, error, fallback);
  }
}

function userId(req: Request): string {
  if (!req.user?._id) throw new Error("Unauthorized");
  return String(req.user._id);
}

export class ProjectController {
  list = async (req: Request, res: Response) => {
    const q = queryString(req.query.q);
    return handle(res, "Failed to list projects", "Projects retrieved", () =>
      projectService.list(q),
    );
  };

  get = async (req: Request, res: Response) => {
    try {
      const data = await projectService.getById(parseRouteId(req.params.id));
      if (!data) {
        return fail(res, null, "Project not found");
      }
      return ok(res, "Project retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to get project");
    }
  };

  create = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to create project",
      "Project created",
      () => projectService.create(parseCreateProjectDto(req.body)),
      201,
    );
  };

  update = async (req: Request, res: Response) => {
    return handle(res, "Failed to update project", "Project updated", () =>
      projectService.update(
        parseRouteId(req.params.id),
        parseUpdateProjectDto(req.body),
      ),
    );
  };

  remove = async (req: Request, res: Response) => {
    return handle(res, "Failed to delete project", "Project deleted", async () => {
      await projectService.remove(parseRouteId(req.params.id));
      return null;
    });
  };

  listDocuments = async (req: Request, res: Response) => {
    return handle(res, "Failed to list documents", "Documents retrieved", () =>
      projectDocumentService.listByProject(parseRouteId(req.params.id)),
    );
  };

  uploadDocument = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to upload document",
      (data: { linked?: boolean }) =>
        data.linked ? "Linked existing file" : "Document uploaded",
      () =>
        projectDocumentService.upload(
          parseRouteId(req.params.id),
          parseProjectDocumentKind(req.params.kind),
          req.file!,
          {
            force: queryBool(req.query.force),
            uploadedByUserId: req.user ? String(req.user._id) : undefined,
          },
        ),
      201,
    );
  };

  downloadDocument = async (req: Request, res: Response) => {
    return streamDownload(
      res,
      () =>
        projectDocumentService.openDownload(
          parseRouteId(req.params.id),
          parseRouteId(req.params.docId),
        ),
      "Failed to download document",
    );
  };

  setCurrentDocument = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to set current document",
      "Document version set as current",
      () =>
        projectDocumentService.setCurrent(
          parseRouteId(req.params.id),
          parseRouteId(req.params.docId),
        ),
    );
  };

  renameDocument = async (req: Request, res: Response) => {
    return handle(res, "Failed to rename document", "Document renamed", () => {
      const { originalFilename } = parseRenameProjectFileDto(req.body);
      return projectDocumentService.rename(
        parseRouteId(req.params.id),
        parseRouteId(req.params.docId),
        originalFilename,
      );
    });
  };

  deleteDocument = async (req: Request, res: Response) => {
    return handle(res, "Failed to delete document", "Document deleted", () =>
      projectDocumentService.softDelete(
        parseRouteId(req.params.id),
        parseRouteId(req.params.docId),
        req.user ? String(req.user._id) : undefined,
      ),
    );
  };

  listLooseFiles = async (req: Request, res: Response) => {
    return handle(res, "Failed to list loose files", "Loose files retrieved", () =>
      projectLooseFileService.listByProject(parseRouteId(req.params.id)),
    );
  };

  uploadLooseFile = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to upload file",
      (data: { linked?: boolean }) =>
        data.linked ? "Linked existing file" : "File uploaded",
      () =>
        projectLooseFileService.upload(
          parseRouteId(req.params.id),
          parseProjectLooseFileKind(req.params.kind),
          req.file!,
          {
            force: queryBool(req.query.force),
            uploadedByUserId: req.user ? String(req.user._id) : undefined,
          },
        ),
      201,
    );
  };

  downloadLooseFile = async (req: Request, res: Response) => {
    return streamDownload(
      res,
      () =>
        projectLooseFileService.openDownload(
          parseRouteId(req.params.id),
          parseRouteId(req.params.fileId),
        ),
      "Failed to download file",
    );
  };

  renameLooseFile = async (req: Request, res: Response) => {
    return handle(res, "Failed to rename file", "File renamed", () => {
      const { originalFilename } = parseRenameProjectFileDto(req.body);
      return projectLooseFileService.rename(
        parseRouteId(req.params.id),
        parseRouteId(req.params.fileId),
        originalFilename,
      );
    });
  };

  deleteLooseFile = async (req: Request, res: Response) => {
    return handle(res, "Failed to delete file", "File deleted", () =>
      projectLooseFileService.softDelete(
        parseRouteId(req.params.id),
        parseRouteId(req.params.fileId),
        req.user ? String(req.user._id) : undefined,
      ),
    );
  };

  listShopDrawing = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to list Shop Drawing items",
      "Shop Drawing items retrieved",
      () => projectShopDrawingService.listByProject(parseRouteId(req.params.id)),
    );
  };

  createShopDrawingItem = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to create Shop Drawing item",
      "Shop Drawing item created",
      () => {
        return projectShopDrawingService.createItem(
          parseRouteId(req.params.id),
          parseCreateShopDrawingItemDto(req.body),
          req.user ? String(req.user._id) : undefined,
        );
      },
      201,
    );
  };

  renameShopDrawingItem = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to rename Shop Drawing item",
      "Shop Drawing item renamed",
      () => {
        return projectShopDrawingService.updateItem(
          parseRouteId(req.params.id),
          parseRouteId(req.params.itemId),
          parseRenameShopDrawingItemDto(req.body),
        );
      },
    );
  };

  deleteShopDrawingItem = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to delete Shop Drawing item",
      (data: { removedInChange: boolean }) =>
        data.removedInChange
          ? "Item removed in the RAB change; it is deleted on commit"
          : "Shop Drawing item deleted",
      () =>
        projectShopDrawingService.hardDeleteItem(
          parseRouteId(req.params.id),
          parseRouteId(req.params.itemId),
        ),
    );
  };

  restoreShopDrawingItem = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to restore Shop Drawing item",
      "Item restored in the RAB change",
      async () => {
        await projectShopDrawingService.restoreItem(
          parseRouteId(req.params.id),
          parseRouteId(req.params.itemId),
        );
        return null;
      },
    );
  };

  uploadShopDrawingFile = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to upload Shop Drawing file",
      (data: { linked?: boolean }) =>
        data.linked ? "Linked existing file" : "File uploaded",
      () =>
        projectShopDrawingService.upload(
          parseRouteId(req.params.id),
          parseRouteId(req.params.itemId),
          req.file!,
          {
            force: queryBool(req.query.force),
            uploadedByUserId: req.user ? String(req.user._id) : undefined,
          },
        ),
      201,
    );
  };

  downloadShopDrawingFile = async (req: Request, res: Response) => {
    return streamDownload(
      res,
      () =>
        projectShopDrawingService.openDownload(
          parseRouteId(req.params.id),
          parseRouteId(req.params.fileId),
        ),
      "Failed to download Shop Drawing file",
    );
  };

  setCurrentShopDrawingFile = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to set current Shop Drawing file",
      "Shop Drawing version set as current",
      () =>
        projectShopDrawingService.setCurrent(
          parseRouteId(req.params.id),
          parseRouteId(req.params.fileId),
        ),
    );
  };

  deleteShopDrawingFile = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to delete Shop Drawing file",
      "Shop Drawing file deleted",
      async () => {
        await projectShopDrawingService.hardDeleteFile(
          parseRouteId(req.params.id),
          parseRouteId(req.params.fileId),
        );
        return null;
      },
    );
  };

  uploadProductionFile = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to upload File Produksi",
      (data: { linked?: boolean }) =>
        data.linked ? "Linked existing file" : "File Produksi uploaded",
      () =>
        projectShopDrawingService.uploadProductionFile(
          parseRouteId(req.params.id),
          parseRouteId(req.params.itemId),
          req.file!,
          {
            force: queryBool(req.query.force),
            uploadedByUserId: req.user ? String(req.user._id) : undefined,
          },
        ),
      201,
    );
  };

  downloadProductionFile = async (req: Request, res: Response) => {
    return streamDownload(
      res,
      () =>
        projectShopDrawingService.openProductionDownload(
          parseRouteId(req.params.id),
          parseRouteId(req.params.fileId),
        ),
      "Failed to download File Produksi",
    );
  };

  setCurrentProductionFile = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to set current File Produksi",
      "File Produksi version set as current",
      () =>
        projectShopDrawingService.setCurrentProductionFile(
          parseRouteId(req.params.id),
          parseRouteId(req.params.fileId),
        ),
    );
  };

  deleteProductionFile = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to delete File Produksi",
      "File Produksi deleted",
      async () => {
        await projectShopDrawingService.deleteProductionFile(
          parseRouteId(req.params.id),
          parseRouteId(req.params.fileId),
        );
        return null;
      },
    );
  };

  listShopDrawingBoqMaterials = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to list Shop Drawing BOQ materials",
      "Shop Drawing BOQ materials retrieved",
      () =>
        projectShopDrawingBoqService.listMaterials(parseRouteId(req.params.id)),
    );
  };

  shopDrawingBoqSummary = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to load Shop Drawing BOQ summary",
      "Shop Drawing BOQ summary retrieved",
      () => projectShopDrawingBoqService.summary(parseRouteId(req.params.id)),
    );
  };

  shopDrawingBoqOverview = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to load Shop Drawing BOQ overview",
      "Shop Drawing BOQ overview retrieved",
      () =>
        projectShopDrawingBoqService.listCurrentOverview(
          parseRouteId(req.params.id),
        ),
    );
  };

  getShopDrawingBoq = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to load Shop Drawing BOQ",
      (data: unknown) =>
        data ? "Shop Drawing BOQ retrieved" : "No Shop Drawing BOQ",
      () => {
        const itemId = queryString(req.query.itemId);
        const fileId = queryString(req.query.fileId);
        if (!itemId) throw new Error("itemId is required");
        if (!fileId) throw new Error("fileId is required");
        return projectShopDrawingBoqService.get(
          parseRouteId(req.params.id),
          parseRouteId(itemId),
          parseRouteId(fileId),
        );
      },
    );
  };

  upsertShopDrawingBoq = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to save Shop Drawing BOQ",
      "Shop Drawing BOQ saved",
      () =>
        projectShopDrawingBoqService.upsert(
          parseRouteId(req.params.id),
          parseUpsertShopDrawingBoqDto(req.body),
          userId(req),
        ),
    );
  };

  deleteShopDrawingBoq = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to delete Shop Drawing BOQ",
      "Shop Drawing BOQ deleted",
      async () => {
        await projectShopDrawingBoqService.hardDelete(
          parseRouteId(req.params.id),
          parseRouteId(req.params.boqId),
        );
        return null;
      },
    );
  };

  getRab = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to load RAB",
      (data: unknown) => (data ? "RAB retrieved" : "No RAB"),
      () => projectRabService.get(parseRouteId(req.params.id), userId(req)),
    );
  };

  exportRab = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const kindRaw = queryString(req.query.kind) ?? "formal";
      if (kindRaw !== "formal" && kindRaw !== "data") {
        throw new Error("kind must be formal or data");
      }
      const revision = queryString(req.query.revision) ?? "current";
      const { buffer, filename } = await projectRabExportService.export(
        id,
        userId(req),
        kindRaw as RabExportKind,
        revision,
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      return res.send(buffer);
    } catch (error) {
      return fail(res, error, "Failed to export RAB");
    }
  };

  lockRab = async (req: Request, res: Response) => {
    return handle(res, "Failed to lock RAB", "RAB locked", () =>
      projectRabService.lock(parseRouteId(req.params.id), userId(req)),
    );
  };

  rabElaboration = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to load RAB elaboration",
      "RAB elaboration retrieved",
      () => projectRabService.elaboration(parseRouteId(req.params.id)),
    );
  };

  fillRabLineTarif = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to fill tarif on RAB line",
      "Tarif applied to RAB line",
      () =>
        projectRabService.fillTarif(
          parseRouteId(req.params.id),
          parseRabLineKey(req.params.lineKey),
        ),
    );
  };

  patchRabLine = async (req: Request, res: Response) => {
    return handle(res, "Failed to update RAB line", "RAB line updated", () => {
      const dto = parsePatchProjectRabLineDto(req.body);
      return projectRabService.patchLinePrice(
        parseRouteId(req.params.id),
        parseRabLineKey(req.params.lineKey),
        dto.unitPrice,
      );
    });
  };

  listRabLabourItems = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to list RAB labour items",
      "RAB labour items retrieved",
      () => projectRabService.listLabourItems(parseRouteId(req.params.id)),
    );
  };

  addRabLabourLine = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to add labour line",
      "Labour line added",
      () =>
        projectRabService.addLabourLine(
          parseRouteId(req.params.id),
          userId(req),
          parseAddProjectRabLabourLineDto(req.body),
        ),
    );
  };

  removeRabLabourLine = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to remove labour line",
      "Labour line removed",
      () =>
        projectRabService.removeLabourLine(
          parseRouteId(req.params.id),
          parseRabLineKey(req.params.lineKey),
        ),
    );
  };

  listRabChanges = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to list RAB changes",
      "RAB changes retrieved",
      () => projectRabChangeService.list(parseRouteId(req.params.id)),
    );
  };

  getCurrentRabChange = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to load RAB change",
      (data: unknown) =>
        data ? "RAB change draft retrieved" : "No open change",
      () => projectRabChangeService.getCurrent(parseRouteId(req.params.id)),
    );
  };

  getRabChangeById = async (req: Request, res: Response) => {
    return handle(res, "Failed to load RAB change", "RAB change retrieved", () =>
      projectRabChangeService.getById(
        parseRouteId(req.params.id),
        parseRouteId(req.params.changeId),
      ),
    );
  };

  openRabChange = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to open RAB change",
      "RAB change opened",
      () =>
        projectRabChangeService.open(
          parseRouteId(req.params.id),
          userId(req),
          parseOpenProjectRabChangeDto(req.body),
        ),
      201,
    );
  };

  commitRabChange = async (req: Request, res: Response) => {
    return handle(res, "Failed to commit RAB change", "RAB change committed", () =>
      projectRabChangeService.commit(
        parseRouteId(req.params.id),
        userId(req),
      ),
    );
  };

  discardRabChange = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to discard RAB change",
      "RAB change discarded",
      () =>
        projectRabChangeService.discard(
          parseRouteId(req.params.id),
          userId(req),
        ),
    );
  };

  calendarAgenda = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to load calendar agenda",
      "Calendar agenda retrieved",
      () => {
        const projectId = queryString(req.query.projectId);
        return projectCalendarService.agenda({
          projectId: projectId ? parseRouteId(projectId) : undefined,
          nearDays: parseNearDays(req.query.nearDays),
        });
      },
    );
  };

  listCalendar = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to list calendar events",
      "Calendar events retrieved",
      () =>
        projectCalendarService.listByProject(parseRouteId(req.params.id)),
    );
  };

  createCalendarEvent = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to create calendar event",
      "Calendar event created",
      () =>
        projectCalendarService.create(
          parseRouteId(req.params.id),
          parseCreateProjectCalendarEventDto(req.body),
        ),
      201,
    );
  };

  updateCalendarEvent = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to update calendar event",
      "Calendar event updated",
      () =>
        projectCalendarService.update(
          parseRouteId(req.params.id),
          parseRouteId(req.params.eventId),
          parseUpdateProjectCalendarEventDto(req.body),
        ),
    );
  };

  deleteCalendarEvent = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to delete calendar event",
      "Calendar event deleted",
      async () => {
        await projectCalendarService.remove(
          parseRouteId(req.params.id),
          parseRouteId(req.params.eventId),
        );
        return null;
      },
    );
  };
}
