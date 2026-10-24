export type QuotationLogo = {
  buffer: Buffer;
  contentType: string;
};

/** QR + link printed on issued quotations for the client verification page. */
export type QuotationVerifyMark = {
  url: string;
  qrPng: Buffer;
};

export const VERIFY_NOTE =
  "Scan or open the link to view and verify this quotation online until it expires.";

export type LogoImageKind = "png" | "jpeg";

export type LogoImageInfo = {
  kind: LogoImageKind;
  width: number;
  height: number;
};

/** Detect PNG/JPEG by magic bytes and read pixel size; null for anything else. */
export function readLogoImageInfo(buf: Buffer): LogoImageInfo | null {
  if (
    buf.length >= 24 &&
    buf.readUInt32BE(0) === 0x89504e47 &&
    buf.readUInt32BE(4) === 0x0d0a1a0a
  ) {
    return {
      kind: "png",
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }

  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) return null;
      const marker = buf[offset + 1]!;
      // SOF0–SOF15 except DHT (C4), JPG (C8), DAC (CC) carry the frame size.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          kind: "jpeg",
          height: buf.readUInt16BE(offset + 5),
          width: buf.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + buf.readUInt16BE(offset + 2);
    }
  }

  return null;
}

/** Scale to fit inside a box, keeping aspect ratio. */
export function fitBox(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: maxWidth, height: maxHeight };
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}
