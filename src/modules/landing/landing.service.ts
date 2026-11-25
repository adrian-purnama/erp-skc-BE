import { Types } from "mongoose";
import { deleteFileIfExists, uploadFile } from "../../core/gridfs";
import { logger } from "../../core/logger";
import type {
  CreateLandingCategoryDto,
  CreateLandingPostDto,
  LandingCategoryOutDto,
  LandingImageOutDto,
  LandingImageRole,
  LandingPostOutDto,
  PublicLandingDto,
  UpdateLandingCategoryDto,
  UpdateLandingPostDto,
} from "../../dto/landing.dto";
import {
  LandingCategoryRepo,
  type LandingCategoryInterface,
} from "../../models/landingCategory.model";
import {
  LandingPostRepo,
  type LandingImage,
  type LandingPostInterface,
} from "../../models/landingPost.model";
import { toWebp } from "./landingImage";

const logSource = "modules/landing/landing.service.ts";
/** Same bucket as the app logo: everything in it is served publicly at /media/:id. */
const BUCKET = "public";

type CategoryLean = LandingCategoryInterface & { _id: Types.ObjectId };
type PostLean = LandingPostInterface & { _id: Types.ObjectId };

export type LandingUpload = { buffer: Buffer; filename: string };

function imageOut(image: LandingImage | null | undefined): LandingImageOutDto | null {
  if (!image) return null;
  return {
    id: String(image._id ?? image.fileId),
    url: `/media/${String(image.fileId)}`,
    width: image.width,
    height: image.height,
  };
}

function postOut(doc: PostLean): LandingPostOutDto {
  return {
    id: String(doc._id),
    categoryId: String(doc.categoryId),
    slug: doc.slug,
    title: doc.title,
    place: doc.place,
    featured: doc.featured === true,
    published: doc.published === true,
    cover: imageOut(doc.cover),
    logo: imageOut(doc.logo),
    gallery: (doc.gallery ?? []).map((g) => imageOut(g)).filter((g) => g !== null),
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
  };
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}

async function deleteFiles(ids: Types.ObjectId[]): Promise<void> {
  for (const id of ids) {
    try {
      await deleteFileIfExists(BUCKET, id);
    } catch (error) {
      logger.warn(
        error instanceof Error ? error.message : String(error),
        logSource,
        "deleteFiles",
      );
    }
  }
}

/** Convert to WebP and store in the public bucket. Caller links it or deletes it. */
async function storeWebp(upload: LandingUpload, role: LandingImageRole): Promise<LandingImage> {
  const webp = await toWebp(upload.buffer, role);
  const stem = upload.filename.replace(/\.[^.]+$/, "") || role;
  const stored = await uploadFile(BUCKET, {
    buffer: webp.buffer,
    filename: `${stem}.webp`,
    contentType: "image/webp",
    metadata: { kind: `landing.${role}` },
  });
  return { _id: new Types.ObjectId(), fileId: stored.id, width: webp.width, height: webp.height };
}

export class LandingService {
  // ── Categories ────────────────────────────────────────────────────────

  async listCategories(): Promise<LandingCategoryOutDto[]> {
    const [docs, counts] = await Promise.all([
      LandingCategoryRepo.model.find().sort({ sortOrder: 1, label: 1 }).lean().exec(),
      LandingPostRepo.model
        .aggregate<{ _id: Types.ObjectId; n: number }>([
          { $group: { _id: "$categoryId", n: { $sum: 1 } } },
        ])
        .exec(),
    ]);
    const countBy = new Map(counts.map((c) => [String(c._id), c.n]));
    return (docs as CategoryLean[]).map((doc) => ({
      id: String(doc._id),
      slug: doc.slug,
      label: doc.label,
      sortOrder: doc.sortOrder,
      postCount: countBy.get(String(doc._id)) ?? 0,
    }));
  }

  async createCategory(input: CreateLandingCategoryDto): Promise<LandingCategoryOutDto> {
    const last = await LandingCategoryRepo.model
      .findOne()
      .sort({ sortOrder: -1 })
      .lean()
      .exec();
    try {
      const doc = (await LandingCategoryRepo.create({
        label: input.label,
        slug: input.slug,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      })) as unknown as CategoryLean;
      return {
        id: String(doc._id),
        slug: doc.slug,
        label: doc.label,
        sortOrder: doc.sortOrder,
        postCount: 0,
      };
    } catch (error) {
      if (isDuplicateKey(error)) throw new Error(`A category with link "${input.slug}" already exists`);
      throw error;
    }
  }

  async updateCategory(id: string, patch: UpdateLandingCategoryDto): Promise<void> {
    try {
      const updated = await LandingCategoryRepo.findByIdAndUpdate(id, { $set: patch });
      if (!updated) throw new Error("Category not found");
    } catch (error) {
      if (isDuplicateKey(error)) throw new Error(`A category with link "${patch.slug}" already exists`);
      throw error;
    }
  }

  async deleteCategory(id: string): Promise<void> {
    const posts = await LandingPostRepo.model.countDocuments({ categoryId: id }).exec();
    if (posts > 0) {
      throw new Error(`Move or delete its ${posts} post${posts === 1 ? "" : "s"} first`);
    }
    const deleted = await LandingCategoryRepo.deleteOne({ _id: new Types.ObjectId(id) });
    if (!deleted) throw new Error("Category not found");
  }

  async reorderCategories(ids: string[]): Promise<void> {
    const existing = await LandingCategoryRepo.model.find().select({ _id: 1 }).lean().exec();
    const known = new Set(existing.map((c) => String(c._id)));
    if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
      throw new Error("The category list changed. Reload and try again.");
    }
    for (const [index, id] of ids.entries()) {
      await LandingCategoryRepo.findByIdAndUpdate(id, { $set: { sortOrder: index } });
    }
  }

  // ── Posts ─────────────────────────────────────────────────────────────

  private async assertCategory(id: string): Promise<void> {
    const exists = await LandingCategoryRepo.model.exists({ _id: id }).exec();
    if (!exists) throw new Error("Category not found");
  }

  private async loadPost(id: string): Promise<PostLean> {
    const doc = await LandingPostRepo.model.findById(id).lean().exec();
    if (!doc) throw new Error("Post not found");
    return doc as PostLean;
  }

  async listPosts(): Promise<LandingPostOutDto[]> {
    const docs = await LandingPostRepo.model.find().sort({ title: 1 }).lean().exec();
    return (docs as PostLean[]).map(postOut);
  }

  async getPost(id: string): Promise<LandingPostOutDto> {
    return postOut(await this.loadPost(id));
  }

  async createPost(input: CreateLandingPostDto): Promise<LandingPostOutDto> {
    await this.assertCategory(input.categoryId);
    try {
      const doc = (await LandingPostRepo.create({
        categoryId: new Types.ObjectId(input.categoryId),
        slug: input.slug,
        title: input.title,
        place: input.place,
        featured: input.featured,
        published: input.published,
        cover: null,
        logo: null,
        gallery: [],
      })) as unknown as PostLean;
      return postOut(doc);
    } catch (error) {
      if (isDuplicateKey(error)) throw new Error(`This category already has a post with link "${input.slug}"`);
      throw error;
    }
  }

  async updatePost(id: string, patch: UpdateLandingPostDto): Promise<LandingPostOutDto> {
    if (patch.categoryId) await this.assertCategory(patch.categoryId);
    const set: Record<string, unknown> = { ...patch };
    if (patch.categoryId) set.categoryId = new Types.ObjectId(patch.categoryId);
    try {
      const updated = await LandingPostRepo.findByIdAndUpdate(id, { $set: set }, { returnDocument: "after" });
      if (!updated) throw new Error("Post not found");
      return postOut(updated as unknown as PostLean);
    } catch (error) {
      if (isDuplicateKey(error)) throw new Error(`This category already has a post with link "${patch.slug}"`);
      throw error;
    }
  }

  async deletePost(id: string): Promise<void> {
    const post = await this.loadPost(id);
    await LandingPostRepo.deleteOne({ _id: post._id });
    await deleteFiles(
      [post.cover, post.logo, ...(post.gallery ?? [])]
        .filter((img): img is LandingImage => Boolean(img))
        .map((img) => img.fileId),
    );
  }

  // ── Images ────────────────────────────────────────────────────────────

  /** Replace the cover or logo; the old file is removed once the new one is linked. */
  async setSingleImage(
    id: string,
    role: "cover" | "logo",
    upload: LandingUpload,
  ): Promise<LandingPostOutDto> {
    const before = await this.loadPost(id);
    const image = await storeWebp(upload, role);
    let updated: PostLean;
    try {
      const doc = await LandingPostRepo.findByIdAndUpdate(id, { $set: { [role]: image } }, { returnDocument: "after" });
      if (!doc) throw new Error("Post not found");
      updated = doc as unknown as PostLean;
    } catch (error) {
      await deleteFiles([image.fileId]);
      throw error;
    }
    const old = before[role];
    if (old) await deleteFiles([old.fileId]);
    return postOut(updated);
  }

  async removeLogo(id: string): Promise<LandingPostOutDto> {
    const before = await this.loadPost(id);
    const doc = await LandingPostRepo.findByIdAndUpdate(id, { $set: { logo: null } }, { returnDocument: "after" });
    if (!doc) throw new Error("Post not found");
    if (before.logo) await deleteFiles([before.logo.fileId]);
    return postOut(doc as unknown as PostLean);
  }

  /** Append one image to the end of the gallery (uploads run in parallel). */
  async addGalleryImage(id: string, upload: LandingUpload): Promise<LandingImageOutDto> {
    await this.loadPost(id);
    const image = await storeWebp(upload, "gallery");
    try {
      const doc = await LandingPostRepo.findByIdAndUpdate(id, { $push: { gallery: image } });
      if (!doc) throw new Error("Post not found");
    } catch (error) {
      await deleteFiles([image.fileId]);
      throw error;
    }
    const out = imageOut(image);
    if (!out) throw new Error("Upload failed");
    return out;
  }

  async removeGalleryImage(id: string, imageId: string): Promise<void> {
    const post = await this.loadPost(id);
    const image = (post.gallery ?? []).find((g) => String(g._id) === imageId);
    if (!image) throw new Error("Image not found");
    await LandingPostRepo.findByIdAndUpdate(id, {
      $pull: { gallery: { _id: new Types.ObjectId(imageId) } },
    });
    await deleteFiles([image.fileId]);
  }

  async reorderGallery(id: string, ids: string[]): Promise<LandingPostOutDto> {
    const post = await this.loadPost(id);
    const byId = new Map((post.gallery ?? []).map((g) => [String(g._id), g]));
    if (ids.length !== byId.size || new Set(ids).size !== ids.length || ids.some((i) => !byId.has(i))) {
      throw new Error("The gallery changed. Reload and try again.");
    }
    const gallery = ids.map((i) => byId.get(i)).filter((g): g is LandingImage => Boolean(g));
    const doc = await LandingPostRepo.findByIdAndUpdate(id, { $set: { gallery } }, { returnDocument: "after" });
    if (!doc) throw new Error("Post not found");
    return postOut(doc as unknown as PostLean);
  }

  // ── Public website ────────────────────────────────────────────────────

  async publicContent(): Promise<PublicLandingDto> {
    const [categories, posts] = await Promise.all([
      LandingCategoryRepo.model.find().sort({ sortOrder: 1, label: 1 }).lean().exec(),
      LandingPostRepo.model
        .find({ published: true, cover: { $ne: null } })
        .sort({ title: 1 })
        .lean()
        .exec(),
    ]);
    const slugById = new Map((categories as CategoryLean[]).map((c) => [String(c._id), c.slug]));
    const out: PublicLandingDto["posts"] = [];
    for (const doc of posts as PostLean[]) {
      const post = postOut(doc);
      const category = slugById.get(post.categoryId);
      if (!category || !post.cover) continue;
      out.push({
        slug: post.slug,
        category,
        title: post.title,
        place: post.place,
        featured: post.featured,
        cover: post.cover,
        logo: post.logo,
        gallery: post.gallery,
      });
    }
    return {
      categories: (categories as CategoryLean[]).map((c) => ({ slug: c.slug, label: c.label })),
      posts: out,
    };
  }
}

export const landingService = new LandingService();
