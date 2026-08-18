/**
 * Prepare a camera photo for upload from a phone browser.
 *
 * Field uploads fail for boring reasons: a modern iPhone shot is 4-12 MB and a
 * burst of them on site LTE times out, and HEIC/HEIF frames cannot be decoded
 * by Chrome or Android WebView at all. So every capture is normalized to a
 * reasonably sized JPEG when the browser can decode it, and passed through
 * untouched (with a hard size ceiling) when it cannot — an undecodable HEIC
 * still uploads fine, it just stays HEIC.
 */

/** Longest edge after downscaling. Enough detail for damage/finish evidence. */
const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.82;
/** Anything past this is refused outright rather than timing out mid-upload. */
const HARD_MAX_BYTES = 40 * 1024 * 1024;

export class PhotoTooLargeError extends Error {
  constructor(mb: number) {
    super(
      `That photo is ${mb.toFixed(0)} MB — too big to send from the field. Take it again with the camera instead of picking a raw file.`,
    );
    this.name = "PhotoTooLargeError";
  }
}

async function decode(file: File): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(file);
  } catch {
    // HEIC/HEIF outside Safari, or a corrupt frame.
    return null;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", JPEG_QUALITY);
  });
}

export type PreparedPhoto = {
  file: File;
  /** True when the bytes were re-encoded (so callers can label it accurately). */
  normalized: boolean;
};

export async function prepareFieldPhoto(file: File): Promise<PreparedPhoto> {
  if (file.size > HARD_MAX_BYTES) {
    throw new PhotoTooLargeError(file.size / (1024 * 1024));
  }

  const bitmap = await decode(file);
  if (!bitmap) {
    // Undecodable (usually HEIC on Android/Chrome) — send the original bytes.
    return { file, normalized: false };
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { file, normalized: false };
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvasToBlob(canvas);
    if (!blob || blob.size === 0) return { file, normalized: false };
    // A re-encode that came out bigger (already-small or already-optimized
    // source) is not worth keeping.
    if (blob.size >= file.size && scale === 1) return { file, normalized: false };
    const name = file.name.replace(/\.[^.]+$/, "") || "photo";
    return {
      file: new File([blob], `${name}.jpg`, {
        type: "image/jpeg",
        lastModified: file.lastModified,
      }),
      normalized: true,
    };
  } finally {
    bitmap.close?.();
  }
}

/** Human-readable reason for a failed upload attempt. */
export function describeUploadFailure(err: unknown): string {
  if (err instanceof PhotoTooLargeError) return err.message;
  if (err instanceof Error && err.message) {
    if (/network|fetch|load failed/i.test(err.message)) {
      return "No connection while sending. Check signal and retry.";
    }
    return err.message;
  }
  return "Upload failed. Tap retry.";
}
