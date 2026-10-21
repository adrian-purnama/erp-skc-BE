import type { Request, Response } from "express";
import { fail, ok } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import {
  parseConvertItemQtyDto,
  parseCreateFolderDto,
  parseCreateItemDto,
  parseMoveFolderDto,
  parseMoveItemDto,
  parseUpdateFolderDto,
  parseUpdateItemDto,
  parseYmdDate,
  todayYmdUtc,
} from "../../validation/itemMaster";
import { itemMasterService } from "./itemMaster.service";

export class ItemMasterController {
  getTree = async (_req: Request, res: Response) => {
    try {
      const data = await itemMasterService.getTree();
      return ok(res, "Tree retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to get tree");
    }
  };

  getChildren = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const data = await itemMasterService.getChildren(id);
      return ok(res, "Children retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to get children");
    }
  };

  createFolder = async (req: Request, res: Response) => {
    try {
      const input = parseCreateFolderDto(req.body);
      const data = await itemMasterService.createFolder(input);
      return ok(res, "Folder created", data, 201);
    } catch (error) {
      return fail(res, error, "Failed to create folder");
    }
  };

  updateFolder = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const patch = parseUpdateFolderDto(req.body);
      const data = await itemMasterService.updateFolder(id, patch);
      return ok(res, "Folder updated", data);
    } catch (error) {
      return fail(res, error, "Failed to update folder");
    }
  };

  moveFolder = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const input = parseMoveFolderDto(req.body);
      const data = await itemMasterService.moveFolder(id, input);
      return ok(res, "Folder moved", data);
    } catch (error) {
      return fail(res, error, "Failed to move folder");
    }
  };

  deleteFolder = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const forceRaw = req.query.force;
      const force =
        forceRaw === "true" ||
        forceRaw === "1" ||
        forceRaw === "yes";
      await itemMasterService.deleteFolder(id, force);
      return ok(res, "Folder deleted", null);
    } catch (error) {
      return fail(res, error, "Failed to delete folder");
    }
  };

  getItem = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const asOfRaw = req.query.asOf;
      const asOfYmd =
        asOfRaw === undefined
          ? todayYmdUtc()
          : parseYmdDate(asOfRaw, "asOf");
      const data = await itemMasterService.getById(id, asOfYmd);
      if (!data) {
        return fail(res, null, "Item not found", 404);
      }
      return ok(res, "Item retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to get item");
    }
  };

  createItem = async (req: Request, res: Response) => {
    try {
      const input = parseCreateItemDto(req.body);
      const data = await itemMasterService.createItem(input);
      return ok(res, "Item created", data, 201);
    } catch (error) {
      return fail(res, error, "Failed to create item");
    }
  };

  convertItemQty = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const input = parseConvertItemQtyDto(req.body);
      const data = await itemMasterService.convertItemQty(id, input);
      return ok(res, "Converted", data);
    } catch (error) {
      return fail(res, error, "Failed to convert");
    }
  };

  updateItem = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const patch = parseUpdateItemDto(req.body);
      const data = await itemMasterService.updateItem(id, patch);
      return ok(res, "Item updated", data);
    } catch (error) {
      return fail(res, error, "Failed to update item");
    }
  };

  moveItem = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const input = parseMoveItemDto(req.body);
      const data = await itemMasterService.moveItem(id, input);
      return ok(res, "Item moved", data);
    } catch (error) {
      return fail(res, error, "Failed to move item");
    }
  };

  deleteItem = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      await itemMasterService.deleteItem(id);
      return ok(res, "Item deleted", null);
    } catch (error) {
      return fail(res, error, "Failed to delete item");
    }
  };
}
