import type { Request, Response } from "express";
import { handle } from "../../dto/httpResponse";
import { assertUploadFile } from "../../validation/uploadFile";
import { parseRouteId } from "../../validation/parseParam";
import {
  parseCreateLandingCategoryDto,
  parseCreateLandingPostDto,
  parseIdOrder,
  parseUpdateLandingCategoryDto,
  parseUpdateLandingPostDto,
} from "../../validation/landing";
import { parseQuoteRequestDto } from "../../validation/quoteRequest";
import { landingService, type LandingUpload } from "./landing.service";
import { sendQuoteRequest } from "./quoteRequest.service";

export const LANDING_MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

function uploadOf(req: Request): LandingUpload {
  assertUploadFile(req.file, LANDING_MAX_UPLOAD_BYTES);
  const file = req.file;
  if (!file) throw new Error("file is required");
  return { buffer: file.buffer, filename: file.originalname };
}

export class LandingController {
  listCategories = (_req: Request, res: Response) =>
    handle(res, "Failed to load categories", "Categories retrieved", () =>
      landingService.listCategories(),
    );

  createCategory = (req: Request, res: Response) =>
    handle(
      res,
      "Failed to create category",
      "Category created",
      () => landingService.createCategory(parseCreateLandingCategoryDto(req.body)),
      201,
    );

  updateCategory = (req: Request, res: Response) =>
    handle(res, "Failed to update category", "Category updated", async () => {
      await landingService.updateCategory(
        parseRouteId(req.params.id),
        parseUpdateLandingCategoryDto(req.body),
      );
      return null;
    });

  deleteCategory = (req: Request, res: Response) =>
    handle(res, "Failed to delete category", "Category deleted", async () => {
      await landingService.deleteCategory(parseRouteId(req.params.id));
      return null;
    });

  reorderCategories = (req: Request, res: Response) =>
    handle(res, "Failed to reorder categories", "Categories reordered", async () => {
      await landingService.reorderCategories(parseIdOrder(req.body));
      return null;
    });

  listPosts = (_req: Request, res: Response) =>
    handle(res, "Failed to load posts", "Posts retrieved", () => landingService.listPosts());

  getPost = (req: Request, res: Response) =>
    handle(res, "Failed to load post", "Post retrieved", () =>
      landingService.getPost(parseRouteId(req.params.id)),
    );

  createPost = (req: Request, res: Response) =>
    handle(
      res,
      "Failed to create post",
      "Post created",
      () => landingService.createPost(parseCreateLandingPostDto(req.body)),
      201,
    );

  updatePost = (req: Request, res: Response) =>
    handle(res, "Failed to update post", "Post saved", () =>
      landingService.updatePost(parseRouteId(req.params.id), parseUpdateLandingPostDto(req.body)),
    );

  deletePost = (req: Request, res: Response) =>
    handle(res, "Failed to delete post", "Post deleted", async () => {
      await landingService.deletePost(parseRouteId(req.params.id));
      return null;
    });

  setCover = (req: Request, res: Response) =>
    handle(res, "Failed to upload cover", "Cover updated", () =>
      landingService.setSingleImage(parseRouteId(req.params.id), "cover", uploadOf(req)),
    );

  setLogo = (req: Request, res: Response) =>
    handle(res, "Failed to upload logo", "Logo updated", () =>
      landingService.setSingleImage(parseRouteId(req.params.id), "logo", uploadOf(req)),
    );

  removeLogo = (req: Request, res: Response) =>
    handle(res, "Failed to remove logo", "Logo removed", () =>
      landingService.removeLogo(parseRouteId(req.params.id)),
    );

  addGalleryImage = (req: Request, res: Response) =>
    handle(
      res,
      "Failed to upload image",
      "Image added",
      () => landingService.addGalleryImage(parseRouteId(req.params.id), uploadOf(req)),
      201,
    );

  removeGalleryImage = (req: Request, res: Response) =>
    handle(res, "Failed to remove image", "Image removed", async () => {
      await landingService.removeGalleryImage(
        parseRouteId(req.params.id),
        parseRouteId(req.params.imageId),
      );
      return null;
    });

  reorderGallery = (req: Request, res: Response) =>
    handle(res, "Failed to reorder gallery", "Gallery reordered", () =>
      landingService.reorderGallery(parseRouteId(req.params.id), parseIdOrder(req.body)),
    );

  /** Public: website "Request a quote" form, emailed to the company inbox. */
  quoteRequest = (req: Request, res: Response) =>
    handle(res, "Failed to send request", "Request sent", async () => {
      await sendQuoteRequest(parseQuoteRequestDto(req.body));
      return null;
    });

  /** Public: what the website builds from. */
  publicContent = (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=60");
    return handle(res, "Failed to load website content", "Website content", () =>
      landingService.publicContent(),
    );
  };
}
