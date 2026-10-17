import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createId } from "./id.js";
import { createModule } from "../../http/route.js";
import { prisma } from "../../lib/prisma.js";
import { badRequest } from "../../lib/errors.js";
import { UPLOAD_DIR } from "../../config/paths.js";

export const uploadsModule = createModule("/uploads", "Uploads");

const MAX_BYTES = 5 * 1024 * 1024;
// Decided from the file's magic bytes, never from the client-supplied name or MIME type.
const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"],
  ["application/pdf", "pdf"],
]);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

/** Validate and persist an uploaded buffer; returns the Upload record. */
export async function storeUpload(buffer: Buffer, originalName: string, userId: string | null) {
  const type = await fileTypeFromBuffer(buffer);
  if (!type || !ALLOWED.has(type.mime)) throw badRequest("Only JPG, PNG, WebP, GIF, AVIF images or PDF files are allowed");
  const now = new Date();
  const dir = path.join(UPLOAD_DIR, `${now.getUTCFullYear()}`, `${now.getUTCMonth() + 1}`.padStart(2, "0"));
  await mkdir(dir, { recursive: true });
  const name = `${createId()}.${ALLOWED.get(type.mime)}`;
  await writeFile(path.join(dir, name), buffer, { mode: 0o644 });
  const url = `/uploads/${path.relative(UPLOAD_DIR, path.join(dir, name)).split(path.sep).join("/")}`;
  return prisma.upload.create({
    data: { url, filename: originalName.replace(/[^\w.\- ]/g, "_").slice(0, 200), mimeType: type.mime, size: buffer.length, uploadedById: userId },
  });
}

uploadsModule.route({
  method: "post",
  path: "/",
  summary: "Upload an image or PDF (multipart field `file`, max 5 MB)",
  description: "Content type is verified from magic bytes. Files are renamed and served with nosniff.",
  access: "auth",
  status: 201,
  middleware: [upload.single("file")],
  handler: async ({ req, user }) => {
    if (!req.file) throw badRequest("No file uploaded (field name: file)");
    return storeUpload(req.file.buffer, req.file.originalname, user.id);
  },
});
