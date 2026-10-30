import type { Request, Response } from "express";
import { handle } from "../../dto/httpResponse";
import { parseRouteId } from "../../validation/parseParam";
import { parsePurchaseRabStatusFilter, parseSavePurchaseRabDto } from "../../validation/purchasing";
import { queryString } from "../../validation/query";
import { purchaseRabService } from "./purchaseRab.service";

function userId(req: Request): string {
  if (!req.user?._id) throw new Error("Unauthorized");
  return String(req.user._id);
}

export class PurchaseRabController {
  requestable = async (_req: Request, res: Response) => {
    return handle(res, "Failed to load RABs", "RABs retrieved", () => purchaseRabService.requestable());
  };

  list = async (req: Request, res: Response) => {
    return handle(res, "Failed to list RABs", "RABs retrieved", () =>
      purchaseRabService.list({
        status: parsePurchaseRabStatusFilter(queryString(req.query.status)),
        q: queryString(req.query.q),
      }),
    );
  };

  get = async (req: Request, res: Response) => {
    return handle(res, "Failed to load RAB", "RAB retrieved", () =>
      purchaseRabService.get(parseRouteId(req.params.id)),
    );
  };

  create = async (req: Request, res: Response) => {
    return handle(
      res,
      "Failed to create RAB",
      "RAB created",
      () => purchaseRabService.create(parseSavePurchaseRabDto(req.body), userId(req)),
      201,
    );
  };

  update = async (req: Request, res: Response) => {
    return handle(res, "Failed to save RAB", "RAB saved", () =>
      purchaseRabService.update(parseRouteId(req.params.id), parseSavePurchaseRabDto(req.body)),
    );
  };

  remove = async (req: Request, res: Response) => {
    return handle(res, "Failed to delete RAB", "RAB deleted", async () => {
      await purchaseRabService.remove(parseRouteId(req.params.id));
      return null;
    });
  };

  lock = async (req: Request, res: Response) => {
    return handle(res, "Failed to lock RAB", "RAB locked", () =>
      purchaseRabService.lock(parseRouteId(req.params.id), userId(req)),
    );
  };

  unlock = async (req: Request, res: Response) => {
    return handle(res, "Failed to unlock RAB", "RAB unlocked", () =>
      purchaseRabService.unlock(parseRouteId(req.params.id)),
    );
  };
}
