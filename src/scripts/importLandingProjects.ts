/**
 * One-off import of the website's old folder-based projects into Website
 * content (landing module). Reads <dir>/<category>/<project>/ with
 * project.json ({ title, place, featured? }), card.*, logo.* and gallery/*.
 * Images go through the same WebP conversion as uploads. Categories and posts
 * that already exist (same link name) are skipped, so a rerun is safe.
 *
 *   npx tsx --env-file=.env src/scripts/importLandingProjects.ts <dir>           # dry run
 *   npx tsx --env-file=.env src/scripts/importLandingProjects.ts <dir> --apply
 *
 * <dir> is the landing site's public/projects folder.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import mongoose from "mongoose";
import { connectDatabase } from "../core/database";
import { env } from "../core/env";
import { landingService } from "../modules/landing";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif"]);

/** Labels the website used before; other folders get a title-cased name. */
const KNOWN_LABELS: Record<string, string> = {
  healthcare: "Healthcare",
  education: "Education",
  "commercial-retail": "Commercial & retail",
  "property-hospitality": "Property & hospitality",
  "public-landmark": "Public & landmark",
};
const KNOWN_ORDER = Object.keys(KNOWN_LABELS);

function dirs(path: string): string[] {
  return readdirSync(path).filter((n) => !n.startsWith(".") && statSync(join(path, n)).isDirectory());
}

function images(path: string): string[] {
  try {
    return readdirSync(path)
      .filter((n) => IMAGE_EXT.has(extname(n).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  } catch {
    return [];
  }
}

function named(path: string, stem: string): string | null {
  const hit = images(path).find((n) => basename(n, extname(n)).toLowerCase() === stem);
  return hit ? join(path, hit) : null;
}

function upload(file: string) {
  return { buffer: readFileSync(file), filename: basename(file) };
}

async function main(): Promise<void> {
  const root = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!root || root.startsWith("--")) throw new Error("Pass the public/projects folder as the first argument");

  await connectDatabase(env.mongodbUrl, env.build);

  const categories = await landingService.listCategories();
  const posts = await landingService.listPosts();
  const categoryFolders = dirs(root).sort(
    (a, b) => (KNOWN_ORDER.indexOf(a) + 1 || 99) - (KNOWN_ORDER.indexOf(b) + 1 || 99),
  );

  for (const folder of categoryFolders) {
    let category = categories.find((c) => c.slug === folder);
    if (!category) {
      const label =
        KNOWN_LABELS[folder] ?? folder.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
      console.log(`+ category ${folder} (${label})`);
      if (apply) {
        category = await landingService.createCategory({ label, slug: folder });
        categories.push(category);
      }
    }

    for (const slug of dirs(join(root, folder))) {
      const dir = join(root, folder, slug);
      if (category && posts.some((p) => p.categoryId === category.id && p.slug === slug)) {
        console.log(`  = ${folder}/${slug} already imported`);
        continue;
      }
      const meta = JSON.parse(readFileSync(join(dir, "project.json"), "utf8")) as {
        title: string;
        place: string;
        featured?: boolean;
      };
      const card = named(dir, "card");
      const logo = named(dir, "logo");
      const gallery = images(join(dir, "gallery")).map((n) => join(dir, "gallery", n));
      console.log(`  + ${folder}/${slug}: ${meta.title}, ${gallery.length} gallery images`);
      if (!apply || !category) continue;

      const post = await landingService.createPost({
        categoryId: category.id,
        slug,
        title: meta.title,
        place: meta.place,
        featured: meta.featured === true,
        published: true,
      });
      if (card) await landingService.setSingleImage(post.id, "cover", upload(card));
      if (logo) await landingService.setSingleImage(post.id, "logo", upload(logo));
      for (const file of gallery) {
        await landingService.addGalleryImage(post.id, upload(file));
      }
    }
  }

  if (!apply) console.log("\nDry run. Add --apply to import.");
  await mongoose.disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect();
  process.exit(1);
});
