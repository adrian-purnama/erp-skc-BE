import type { Request, Response } from "express";
import { fail, handle, ok } from "../../dto/httpResponse";
import type { ApiResponseDto } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import { queryBool, queryString } from "../../validation/query";
import {
  parseConvertItemQtyDto,
  parseCreateFolderDto,
  parseCreateItemCategoryDto,
  parseCreateItemDto,
  parseMoveFolderDto,
  parseMoveItemDto,
  parseUpdateFolderDto,
  parseUpdateItemCategoryDto,
  parseUpdateItemDto,
  parseYmdDate,
  todayYmdUtc,
} from "../../validation/itemMaster";
import {
  ItemBulkValidationError,
  itemBulkService,
} from "./itemBulk.service";
import { itemCategoryService } from "./itemCategory.service";
import { itemMasterService } from "./itemMaster.service";

export class ItemMasterController {
  getTree = async (_req: Request, res: Response) => {
    return handle(res, "Failed to get tree", "Tree retrieved", () =>
      itemMasterService.getTree(),
    );
  };

  listItemCategories = async (_req: Request, res: Response) => {
    return handle(
      res,
      "Failed to list categories",
      "Categories retrieved",
      () => itemCategoryService.list(),
    );
  };

  createItemCategory = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to create category",
      "Category created",
      () =>
        itemCategoryService.create(parseCreateItemCategoryDto(req.body)),
      201,
    );
  };

  updateItemCategory = async (req: Request, res: Response) => {
    return handle(res, "Failed to update category", "Category updated", () =>
      itemCategoryService.update(
        parseRouteId(req.params.id),
        parseUpdateItemCategoryDto(req.body),
      ),
    );
  };

  deleteItemCategory = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to delete category",
      "Category deleted",
      async () => {
        await itemCategoryService.remove(parseRouteId(req.params.id));
        return null;
      },
    );
  };

  getChildren = async (req: Request, res: Response) => {
    return handle(res, "Failed to get children", "Children retrieved", () =>
      itemMasterService.getChildren(parseRouteId(req.params.id)),
    );
  };

  createFolder = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to create folder",
      "Folder created",
      () => itemMasterService.createFolder(parseCreateFolderDto(req.body)),
      201,
    );
  };

  updateFolder = async (req: Request, res: Response) => {
    return handle(res, "Failed to update folder", "Folder updated", () =>
      itemMasterService.updateFolder(
        parseRouteId(req.params.id),
        parseUpdateFolderDto(req.body),
      ),
    );
  };

  moveFolder = async (req: Request, res: Response) => {
    return handle(res, "Failed to move folder", "Folder moved", () =>
      itemMasterService.moveFolder(
        parseRouteId(req.params.id),
        parseMoveFolderDto(req.body),
      ),
    );
  };

  deleteFolder = async (req: Request, res: Response) => {
    return handle(res, "Failed to delete folder", "Folder deleted", async () => {
      await itemMasterService.deleteFolder(
        parseRouteId(req.params.id),
        queryBool(req.query.force),
      );
      return null;
    });
  };

  getItem = async (req: Request, res: Response) => {
    try {
      const id = parseRouteId(req.params.id);
      const asOf = queryString(req.query.asOf);
      const data = await itemMasterService.getById(
        id,
        asOf === undefined ? todayYmdUtc() : parseYmdDate(asOf, "asOf"),
      );
      if (!data) {
        return fail(res, null, "Item not found", 404);
      }
      return ok(res, "Item retrieved", data);
    } catch (error) {
      return fail(res, error, "Failed to get item");
    }
  };

  createItem = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to create item",
      "Item created",
      () => itemMasterService.createItem(parseCreateItemDto(req.body)),
      201,
    );
  };

  downloadBulkTemplate = async (_req: Request, res: Response) => {
    try {
      const buffer = await itemBulkService.buildTemplate();
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="item-master-template.xlsx"',
      );
      return res.send(buffer);
    } catch (error) {
      return fail(res, error, "Failed to build template");
    }
  };

  uploadBulk = async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file?.buffer?.length) {
        return fail(res, null, "file required");
      }
      const data = await itemBulkService.importBuffer(file.buffer);
      return ok(res, `Created ${data.created} item(s)`, data, 201);
    } catch (error) {
      if (error instanceof ItemBulkValidationError) {
        return res.status(400).json({
          success: false,
          message: error.message,
          data: { errors: error.errors },
        } satisfies ApiResponseDto<{ errors: typeof error.errors }>);
      }
      return fail(res, error, "Failed to import items");
    }
  };

  convertItemQty = async (req: Request, res: Response) => {
    return handle(res, "Failed to convert", "Converted", () =>
      itemMasterService.convertItemQty(
        parseRouteId(req.params.id),
        parseConvertItemQtyDto(req.body),
      ),
    );
  };

  updateItem = async (req: Request, res: Response) => {
    return handle(res, "Failed to update item", "Item updated", () =>
      itemMasterService.updateItem(
        parseRouteId(req.params.id),
        parseUpdateItemDto(req.body),
      ),
    );
  };

  moveItem = async (req: Request, res: Response) => {
    return handle(res, "Failed to move item", "Item moved", () =>
      itemMasterService.moveItem(
        parseRouteId(req.params.id),
        parseMoveItemDto(req.body),
      ),
    );
  };

  deleteItem = async (req: Request, res: Response) => {
    return handle(res, "Failed to delete item", "Item deleted", async () => {
      await itemMasterService.deleteItem(parseRouteId(req.params.id));
      return null;
    });
  };
}
