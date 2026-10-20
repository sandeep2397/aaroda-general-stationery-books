import { put } from "@vercel/blob";
import { getFirebaseUser } from "@/lib/firebase-server";
import { getDb } from "@/lib/mongodb";
import { ensureCollections } from "@/lib/mongo-schema";
import { hasPermission } from "@/lib/user-roles";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const safePathSegment = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 100) || "uncategorized";

export async function POST(request: Request) {
  const user = await getFirebaseUser(request);
  if (!user) return Response.json({ error: "Please sign in before uploading images." }, { status: 401 });
  try {
    const db = await getDb();
    await ensureCollections(db);
    if (!await hasPermission(db, user, "inventory:write")) return Response.json({ error: "Only administrators can upload catalog images." }, { status: 403 });
    const form = await request.formData();
    const file = form.get("file");
    const productId = String(form.get("productId") || "inventory");
    if (!(file instanceof File)) return Response.json({ error: "Select an image to upload." }, { status: 400 });
    if (!file.type.startsWith("image/")) return Response.json({ error: "Only image files can be uploaded." }, { status: 400 });
    if (file.size > MAX_IMAGE_BYTES) return Response.json({ error: "Images must be 4 MB or smaller." }, { status: 400 });

    const extension = file.name.includes(".") ? `.${file.name.split(".").pop()}` : "";
    const pathname = `Stationery/${safePathSegment(productId)}/${Date.now()}-${safePathSegment(file.name.replace(/\.[^.]+$/, ""))}${extension}`;
    const blob = await put(pathname, file, { access: "public", addRandomSuffix: true, contentType: file.type, storeId: process.env.BLOB_STORE_ID, token: process.env.BLOB_READ_WRITE_TOKEN });
    return Response.json({
      url: blob.url,
      pathname: blob.pathname,
      metadata: { name: file.name, contentType: file.type, size: file.size, productId, uploadedBy: user.userId, uploadedAt: new Date().toISOString() },
    });
  } catch (error) {
    console.error("POST /api/inventory/upload error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Unable to upload the image to Vercel Blob." }, { status: 500 });
  }
}
