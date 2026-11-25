import sharp from "sharp";
import type { LandingImageRole } from "../../dto/landing.dto";

/** Longest side (px) and WebP quality per role, sized for the website. */
const PRESETS: Record<LandingImageRole, { maxSide: number; quality: number }> = {
  cover: { maxSide: 2400, quality: 80 },
  gallery: { maxSide: 2000, quality: 78 },
  logo: { maxSide: 800, quality: 90 },
};

export type WebpImage = { buffer: Buffer; width: number; height: number };

/**
 * Convert any image sharp can read (JPEG, PNG, WebP, GIF, AVIF, TIFF, SVG) to a
 * compressed WebP: EXIF rotation applied, metadata stripped, never enlarged.
 */
export async function toWebp(input: Buffer, role: LandingImageRole): Promise<WebpImage> {
  const { maxSide, quality } = PRESETS[role];
  try {
    const { data, info } = await sharp(input, { density: 300, limitInputPixels: 120_000_000 })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .webp({ quality, effort: 5 })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch {
    throw new Error("This file is not an image we can read");
  }
}
