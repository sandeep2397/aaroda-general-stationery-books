import { ObjectId } from "mongodb";
import { getFirebaseUser } from "@/lib/firebase-server";
import { getDb } from "@/lib/mongodb";
import { ensureCollections } from "@/lib/mongo-schema";
import { applyRateLimit } from "@/lib/rate-limiter";

const required = ["label", "recipientName", "phone", "line1", "city", "state", "postalCode"] as const;

export async function GET(request: Request) {
  const user = await getFirebaseUser(request);
  if (!user) return Response.json({ error: "Please sign in to manage addresses." }, { status: 401 });
  try {
    const db = await getDb(); await ensureCollections(db);
    const addresses = await db.collection("addresses").find({ userId: user.userId }).sort({ isDefault: -1, updatedAt: -1 }).toArray();
    return Response.json({ addresses: addresses.map(({ _id, ...address }) => ({ id: _id.toString(), ...address })) });
  } catch { return Response.json({ error: "Unable to load addresses." }, { status: 500 }); }
}

export async function POST(request: Request) {
  const limited = applyRateLimit(request, "write"); if (limited) return limited;
  const user = await getFirebaseUser(request);
  if (!user) return Response.json({ error: "Please sign in before saving an address." }, { status: 401 });
  try {
    const body = await request.json();
    for (const field of required) if (!String(body[field] || "").trim()) return Response.json({ error: `${field} is required.` }, { status: 400 });
    const phone = String(body.phone).replace(/\D/g, "");
    if (phone.length !== 10) return Response.json({ error: "Enter a valid 10-digit mobile number." }, { status: 400 });
    if (!/^\d{6}$/.test(String(body.postalCode).trim())) return Response.json({ error: "Enter a valid 6-digit PIN code." }, { status: 400 });
    const db = await getDb(); await ensureCollections(db); const addresses = db.collection("addresses"); const users = db.collection("users"); const now = new Date();
    const address = { userId: user.userId, label: String(body.label).trim(), recipientName: String(body.recipientName).trim(), phone, line1: String(body.line1).trim(), line2: String(body.line2 || "").trim(), landmark: String(body.landmark || "").trim(), city: String(body.city).trim(), state: String(body.state).trim(), postalCode: String(body.postalCode).trim(), location: body.location && typeof body.location === "object" ? body.location : undefined, isDefault: Boolean(body.isDefault), updatedAt: now };
    if (address.isDefault) await addresses.updateMany({ userId: user.userId }, { $set: { isDefault: false, updatedAt: now } });
    const id = body.id && ObjectId.isValid(body.id) ? new ObjectId(body.id) : null;
    if (id) {
      const result = await addresses.updateOne({ _id: id, userId: user.userId }, { $set: address });
      if (!result.matchedCount) return Response.json({ error: "Address not found." }, { status: 404 });
      await users.updateOne({ userId: user.userId, "addresses.id": id.toString() }, { $set: { "addresses.$": { id: id.toString(), ...address }, updatedAt: now, lastAddressSavedAt: now } });
      return Response.json({ success: true, address: { id: id.toString(), ...address } });
    }
    const result = await addresses.insertOne({ ...address, createdAt: now });
    const savedAddress = { id: result.insertedId.toString(), ...address, createdAt: now };
    await users.updateOne({ userId: user.userId }, { $set: { email: user.email || "", updatedAt: now, lastAddressSavedAt: now }, $setOnInsert: { userId: user.userId, displayName: "", photoURL: "", addresses: [], createdAt: now }, $push: { addresses: savedAddress } } as never, { upsert: true });
    return Response.json({ success: true, address: savedAddress }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to save address." }, { status: 500 }); }
}
