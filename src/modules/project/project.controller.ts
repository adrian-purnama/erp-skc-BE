import type { Request, Response } from "express";
import { fail, ok } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
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
  parsePatchProjectRabLineDto,
  parseRabLineKey,
} from "../../validation/projectRab";
import { parseProjectLooseFileKind } from "../../validation/projectLooseFile";
import { projectCalendarService } from "./projectCalendar.service";
import { projectDocumentService } from "./projectDocument.service";
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

export class ProjectController {
  list = async (req: Request, res: Response) => {
    try {
      const q =
        typeof req.query.q === "string" ? req.query.q : undefined;
      const data = await projectService.list(q);
      return ok(res, "Projects retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to list projects");
    }
  };

  get = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const data = await projectService.getById(id);
      if (!data) {
        return fail(res, null, "Project not found");
      }
      return ok(res, "Project retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to get project");
    }
  };

  create = async (req: Request, res: Response) => {
    try {
      const input = parseCreateProjectDto(req.body);
      const data = await projectService.create(input);
      return ok(res, "Project created", data, 201);
    } catch (error) {
      return fail(res, error, "Failed to create project");
    }
  };

  update = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const patch = parseUpdateProjectDto(req.body);
      const data = await projectService.update(id, patch);
      return ok(res, "Project updated", data);
    } catch (error) {
      return fail(res, error, "Failed to update project");
    }
  };

  remove = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      await projectService.remove(id);
      return ok(res, "Project deleted", null);
    } catch (error) {
      return fail(res, error, "Failed to delete project");
    }
  };

  listDocuments = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const data = await projectDocumentService.listByProject(id);
      return ok(res, "Documents retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to list documents");
    }
  };

  uploadDocument = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const kind = parseProjectDocumentKind(req.params.kind);
      const file = req.file;
      if (!file) throw new Error("file is required");
      const force =
        req.query.force === "true" || req.query.force === "1";
      const uploadedByUserId = req.user ? String(req.user._id) : undefined;
      const data = await projectDocumentService.upload(id, kind, file, {
        force,
        uploadedByUserId,
      });
      return ok(
        res,
        data.linked ? "Linked existing file" : "Document uploaded",
        data,
        201,
      );
    } catch (error) {
      return fail(res, error, "Failed to upload document");
    }
  };

  downloadDocument = async (req: Request, res: Response) => {
    return streamDownload(
      res,
      () => {
        const id = parseRouteId(req.params.id);
        const docId = parseRouteId(req.params.docId);
        return projectDocumentService.openDownload(id, docId);
      },
      "Failed to download document",
    );
  };

  setCurrentDocument = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const docId = parseRouteId(req.params.docId);
      const data = await projectDocumentService.setCurrent(id, docId);
      return ok(res, "Document version set as current", data);
    } catch (error) {
      return fail(res, error, "Failed to set current document");
    }
  };

  renameDocument = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const docId = parseRouteId(req.params.docId);
      const { originalFilename } = parseRenameProjectFileDto(req.body);
      const data = await projectDocumentService.rename(
        id,
        docId,
        originalFilename,
      );
      return ok(res, "Document renamed", data);
    } catch (error) {
      return fail(res, error, "Failed to rename document");
    }
  };

  deleteDocument = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const docId = parseRouteId(req.params.docId);
      const deletedByUserId = req.user ? String(req.user._id) : undefined;
      const data = await projectDocumentService.softDelete(
        id,
        docId,
        deletedByUserId,
      );
      return ok(res, "Document deleted", data);
    } catch (error) {
      return fail(res, error, "Failed to delete document");
    }
  };

  listLooseFiles = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const data = await projectLooseFileService.listByProject(id);
      return ok(res, "Loose files retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to list loose files");
    }
  };

  uploadLooseFile = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const kind = parseProjectLooseFileKind(req.params.kind);
      const file = req.file;
      if (!file) throw new Error("file is required");
      const force =
        req.query.force === "true" || req.query.force === "1";
      const uploadedByUserId = req.user ? String(req.user._id) : undefined;
      const data = await projectLooseFileService.upload(id, kind, file, {
        force,
        uploadedByUserId,
      });
      return ok(
        res,
        data.linked ? "Linked existing file" : "File uploaded",
        data,
        201,
      );
    } catch (error) {
      return fail(res, error, "Failed to upload file");
    }
  };

  downloadLooseFile = async (req: Request, res: Response) => {
    return streamDownload(
      res,
      () => {
        const id = parseRouteId(req.params.id);
        const fileId = parseRouteId(req.params.fileId);
        return projectLooseFileService.openDownload(id, fileId);
      },
      "Failed to download file",
    );
  };

  renameLooseFile = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const fileId = parseRouteId(req.params.fileId);
      const { originalFilename } = parseRenameProjectFileDto(req.body);
      const data = await projectLooseFileService.rename(
        id,
        fileId,
        originalFilename,
      );
      return ok(res, "File renamed", data);
    } catch (error) {
      return fail(res, error, "Failed to rename file");
    }
  };

  deleteLooseFile = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const fileId = parseRouteId(req.params.fileId);
      const deletedByUserId = req.user ? String(req.user._id) : undefined;
      const data = await projectLooseFileService.softDelete(
        id,
        fileId,
        deletedByUserId,
      );
      return ok(res, "File deleted", data);
    } catch (error) {
      return fail(res, error, "Failed to delete file");
    }
  };

  listShopDrawing = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const data = await projectShopDrawingService.listByProject(id);
      return ok(res, "Shop Drawing items retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to list Shop Drawing items");
    }
  };

  createShopDrawingItem = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const { name } = parseCreateShopDrawingItemDto(req.body);
      const createdByUserId = req.user ? String(req.user._id) : undefined;
      const data = await projectShopDrawingService.createItem(
        id,
        name,
        createdByUserId,
      );
      return ok(res, "Shop Drawing item created", data, 201);
    } catch (error) {
      return fail(res, error, "Failed to create Shop Drawing item");
    }
  };

  renameShopDrawingItem = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const itemId = parseRouteId(req.params.itemId);
      const { name } = parseRenameShopDrawingItemDto(req.body);
      const data = await projectShopDrawingService.renameItem(id, itemId, name);
      return ok(res, "Shop Drawing item renamed", data);
    } catch (error) {
      return fail(res, error, "Failed to rename Shop Drawing item");
    }
  };

  deleteShopDrawingItem = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const itemId = parseRouteId(req.params.itemId);
      await projectShopDrawingService.hardDeleteItem(id, itemId);
      return ok(res, "Shop Drawing item deleted", null);
    } catch (error) {
      return fail(res, error, "Failed to delete Shop Drawing item");
    }
  };

  uploadShopDrawingFile = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const itemId = parseRouteId(req.params.itemId);
      const file = req.file;
      if (!file) throw new Error("file is required");
      const force =
        req.query.force === "true" || req.query.force === "1";
      const uploadedByUserId = req.user ? String(req.user._id) : undefined;
      const data = await projectShopDrawingService.upload(id, itemId, file, {
        force,
        uploadedByUserId,
      });
      return ok(
        res,
        data.linked ? "Linked existing file" : "File uploaded",
        data,
        201,
      );
    } catch (error) {
      return fail(res, error, "Failed to upload Shop Drawing file");
    }
  };

  downloadShopDrawingFile = async (req: Request, res: Response) => {
    return streamDownload(
      res,
      () => {
        const id = parseRouteId(req.params.id);
        const fileId = parseRouteId(req.params.fileId);
        return projectShopDrawingService.openDownload(id, fileId);
      },
      "Failed to download Shop Drawing file",
    );
  };

  setCurrentShopDrawingFile = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const fileId = parseRouteId(req.params.fileId);
      const data = await projectShopDrawingService.setCurrent(id, fileId);
      return ok(res, "Shop Drawing version set as current", data);
    } catch (error) {
      return fail(res, error, "Failed to set current Shop Drawing file");
    }
  };

  deleteShopDrawingFile = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const fileId = parseRouteId(req.params.fileId);
      await projectShopDrawingService.hardDeleteFile(id, fileId);
      return ok(res, "Shop Drawing file deleted", null);
    } catch (error) {
      return fail(res, error, "Failed to delete Shop Drawing file");
    }
  };

  listShopDrawingBoqMaterials = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const data = await projectShopDrawingBoqService.listMaterials(id);
      return ok(res, "Shop Drawing BOQ materials retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to list Shop Drawing BOQ materials");
    }
  };

  shopDrawingBoqSummary = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const data = await projectShopDrawingBoqService.summary(id);
      return ok(res, "Shop Drawing BOQ summary retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to load Shop Drawing BOQ summary");
    }
  };

  getShopDrawingBoq = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      if (typeof req.query.itemId !== "string") {
        throw new Error("itemId is required");
      }
      if (typeof req.query.fileId !== "string") {
        throw new Error("fileId is required");
      }
      const itemId = parseRouteId(req.query.itemId);
      const fileId = parseRouteId(req.query.fileId);
      const data = await projectShopDrawingBoqService.get(id, itemId, fileId);
      return ok(
        res,
        data ? "Shop Drawing BOQ retrieved" : "No Shop Drawing BOQ",
        data,
      );
    } catch (error) {
      return fail(res, error, "Failed to load Shop Drawing BOQ");
    }
  };

  upsertShopDrawingBoq = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const dto = parseUpsertShopDrawingBoqDto(req.body);
      const data = await projectShopDrawingBoqService.upsert(id, dto);
      return ok(res, "Shop Drawing BOQ saved", data);
    } catch (error) {
      return fail(res, error, "Failed to save Shop Drawing BOQ");
    }
  };

  deleteShopDrawingBoq = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const boqId = parseRouteId(req.params.boqId);
      await projectShopDrawingBoqService.hardDelete(id, boqId);
      return ok(res, "Shop Drawing BOQ deleted", null);
    } catch (error) {
      return fail(res, error, "Failed to delete Shop Drawing BOQ");
    }
  };

  getRab = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      if (!req.user?._id) throw new Error("Unauthorized");
      const data = await projectRabService.get(id, String(req.user._id));
      return ok(res, data ? "RAB retrieved" : "No RAB", data);
    } catch (error) {
      return fail(res, error, "Failed to load RAB");
    }
  };

  lockRab = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      if (!req.user?._id) throw new Error("Unauthorized");
      const data = await projectRabService.lock(id, String(req.user._id));
      return ok(res, "RAB locked", data);
    } catch (error) {
      return fail(res, error, "Failed to lock RAB");
    }
  };

  rabElaboration = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const data = await projectRabService.elaboration(id);
      return ok(res, "RAB elaboration retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to load RAB elaboration");
    }
  };

  fillRabLineTarif = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const lineKey = parseRabLineKey(req.params.lineKey);
      const data = await projectRabService.fillTarif(id, lineKey);
      return ok(res, "Tarif applied to RAB line", data);
    } catch (error) {
      return fail(res, error, "Failed to fill tarif on RAB line");
    }
  };

  patchRabLine = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const lineKey = parseRabLineKey(req.params.lineKey);
      const dto = parsePatchProjectRabLineDto(req.body);
      const data = await projectRabService.patchLinePrice(
        id,
        lineKey,
        dto.unitPrice,
      );
      return ok(res, "RAB line updated", data);
    } catch (error) {
      return fail(res, error, "Failed to update RAB line");
    }
  };

  calendarAgenda = async (req: Request, res: Response) => {
    try {
      const projectId =
        typeof req.query.projectId === "string" && req.query.projectId.trim()
          ? parseRouteId(req.query.projectId)
          : undefined;
      const nearDays = parseNearDays(req.query.nearDays);
      const data = await projectCalendarService.agenda({ projectId, nearDays });
      return ok(res, "Calendar agenda retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to load calendar agenda");
    }
  };

  listCalendar = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const data = await projectCalendarService.listByProject(id);
      return ok(res, "Calendar events retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to list calendar events");
    }
  };

  createCalendarEvent = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const dto = parseCreateProjectCalendarEventDto(req.body);
      const data = await projectCalendarService.create(id, dto);
      return ok(res, "Calendar event created", data, 201);
    } catch (error) {
      return fail(res, error, "Failed to create calendar event");
    }
  };

  updateCalendarEvent = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const eventId = parseRouteId(req.params.eventId);
      const dto = parseUpdateProjectCalendarEventDto(req.body);
      const data = await projectCalendarService.update(id, eventId, dto);
      return ok(res, "Calendar event updated", data);
    } catch (error) {
      return fail(res, error, "Failed to update calendar event");
    }
  };

  deleteCalendarEvent = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const eventId = parseRouteId(req.params.eventId);
      await projectCalendarService.remove(id, eventId);
      return ok(res, "Calendar event deleted", null);
    } catch (error) {
      return fail(res, error, "Failed to delete calendar event");
    }
  };
}
