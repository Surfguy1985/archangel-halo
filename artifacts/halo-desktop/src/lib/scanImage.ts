const SUPPORTED_RAW = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export type PreparedScanImage = {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  blob: Blob;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      resolve(s.includes(",") ? s.slice(s.indexOf(",") + 1) : s);
   };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
 });
}

function decodeImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
   };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not decode image"));
   };
    img.src = url;
 });
}

/**
 * Prepare any photo for AI reading: decode, downscale to a high-detail OCR
 * size (max edge 2400px), and re-encode as high-quality JPEG. Also converts
 * HEIC/whatever the camera produced into JPEG when the browser can decode it.
 * Falls back to the raw file when it is already a supported type but cannot
 * be re-encoded (e.g. canvas failure).
 */
export async function prepareScanImage(file: File): Promise<PreparedScanImage> {
  try {
    const img = await decodeImage(file);
    const maxEdge = 2400;
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("no blob"))),
        "image/jpeg",
        0.92,
      );
   });
    return { base64: await blobToBase64(blob), mediaType: "image/jpeg", blob};
 } catch {
    if (SUPPORTED_RAW.includes(file.type)) {
      return {
        base64: await blobToBase64(file),
        mediaType: file.type as PreparedScanImage["mediaType"],
        blob: file,
     };
   }
    throw new Error("unsupported image");
 }
}
