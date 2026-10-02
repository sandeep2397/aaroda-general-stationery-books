import { getDb } from "@/lib/mongodb";
import { bulkUpsertLocalInventory } from "@/lib/catalog";
import { ensureCollections } from "@/lib/mongo-schema";
import { applyRateLimit } from "@/lib/rate-limiter";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export interface ParsedItem {
  sku: string;
  name: string;
  category: string;
  description: string;
  price: number;
  mrp: number;
  stock: number;
  unit: string;
  icon: string;
  imageUrl: string;
  active: boolean;
  hsn?: string;
  gstPercent?: number;
  netRate?: number;
  baseRate?: number;
  invoiceNo?: string;
  metadata?: Record<string, unknown>;
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function detectUnit(name: string, category: string): string {
  const n = name.toLowerCase();
  if (n.includes("pack") || n.includes("pkt") || n.includes("shades")) return "pack";
  if (n.includes("strip") || n.includes("tablet") || n.includes("cap")) return "strip";
  if (n.includes("bottle") || n.includes("ml") || n.includes("spray")) return "bottle";
  if (n.includes("box") || n.includes("kit") || n.includes("set")) return "box";
  if (n.includes("book") || n.includes("notebook") || n.includes("pad")) return "book";
  if (n.includes("sheet") || n.includes("paper") || n.includes("gsm")) return "sheet";
  if (n.includes("jar")) return "jar";
  return category.toLowerCase().includes("med") ? "strip" : "piece";
}

function detectIcon(name: string, category: string): string {
  const n = name.toLowerCase();
  if (n.includes("pen") || n.includes("ball") || n.includes("ink") || n.includes("gel") || n.includes("marker") || n.includes("highlighter")) return "🖊️";
  if (n.includes("pencil") || n.includes("lead") || n.includes("eraser") || n.includes("sharpener")) return "✏️";
  if (n.includes("book") || n.includes("notebook") || n.includes("paper") || n.includes("pad") || n.includes("sheet") || n.includes("xerox")) return "📓";
  if (n.includes("brush") || n.includes("paint") || n.includes("shades") || n.includes("artsy") || n.includes("colour") || n.includes("color") || n.includes("crystal mud")) return "🎨";
  if (n.includes("gum") || n.includes("fevicol") || n.includes("glue") || n.includes("stick")) return "🧴";
  if (n.includes("board") || n.includes("exam pad") || n.includes("geometry") || n.includes("scale") || n.includes("ruler")) return "📐";
  if (n.includes("file") || n.includes("folder")) return "📁";
  if (n.includes("battery") || n.includes("nippo") || n.includes("cell")) return "🔋";
  if (n.includes("dolo") || n.includes("paracetamol") || n.includes("tablet") || n.includes("cetirizine") || n.includes("amoxicillin") || n.includes("ibuprofen") || n.includes("vitamin")) return "💊";
  if (n.includes("band-aid") || n.includes("bandage") || n.includes("gauze") || n.includes("first aid")) return "🩹";
  if (n.includes("balm") || n.includes("vapo") || n.includes("syrup") || n.includes("spray") || n.includes("lotion")) return "🧴";
  return category.toLowerCase().includes("med") ? "💊" : category.toLowerCase().includes("stat") ? "✏️" : "📦";
}

export function extractRowsFromWorkbook(buffer: ArrayBuffer | Buffer): {
  rows: ParsedItem[];
  invoiceMetadata?: Record<string, unknown>;
  warnings: string[];
} {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("No sheets found in uploaded Excel file");

  const sheet = workbook.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });

  const rows: ParsedItem[] = [];
  const warnings: string[] = [];

  // Check if this sheet is an Invoice format (contains metadata in upper rows)
  let invoiceHeaderIndex = -1;
  let billNo = "";
  let billDate = "";
  let supplierName = "";
  let supplierGstin = "";
  let supplierPhone = "";
  let supplierAddress = "";
  let buyerName = "";
  let buyerAddress = "";

  for (let i = 0; i < Math.min(25, grid.length); i++) {
    const row = (grid[i] as string[]) || [];
    const rowText = row.map(String).join(" ");

    if (rowText.includes("Bill No")) {
      const idx = row.findIndex((c) => String(c).includes("Bill No"));
      if (idx >= 0 && row[idx + 1]) billNo = String(row[idx + 1]).trim();
    }
    if (rowText.includes("Bill Dt")) {
      const idx = row.findIndex((c) => String(c).includes("Bill Dt"));
      if (idx >= 0 && row[idx + 1]) billDate = String(row[idx + 1]).trim();
    }
    if (rowText.includes("Buyer")) {
      const idx = row.findIndex((c) => String(c).includes("Buyer"));
      if (idx >= 0 && row[idx + 1]) buyerName = String(row[idx + 1]).trim();
    }
    if (rowText.includes("GSTIN")) {
      const match = rowText.match(/GSTIN\/?UIN:?\s*([0-9A-Z]{15})/i);
      if (match) supplierGstin = match[1];
    }
    if (rowText.includes("Mobile") || rowText.includes("Phone")) {
      const match = rowText.match(/(\d{10})/);
      if (match) supplierPhone = match[1];
    }
    if (i === 1 && row[0] && !supplierName) {
      supplierName = String(row[0]).trim();
    }
    if (i === 4 && row[0] && !supplierAddress) {
      supplierAddress = String(row[0]).trim();
    }

    if (row.some((c) => String(c).toLowerCase().includes("particulars") || String(c).toLowerCase().includes("sr."))) {
      invoiceHeaderIndex = i;
      break;
    }
  }

  const invoiceMetadata = billNo
    ? {
        invoiceNo: billNo,
        invoiceDate: billDate,
        supplier: {
          name: supplierName || "Supplier",
          gstin: supplierGstin,
          phone: supplierPhone,
          address: supplierAddress,
        },
        buyer: {
          name: buyerName,
          address: buyerAddress,
        },
      }
    : undefined;

  // Case 1: Formatted Invoice Structure (e.g. Sales_F11929.xlsx)
  if (invoiceHeaderIndex >= 0) {
    const headerRow = (grid[invoiceHeaderIndex] as string[]).map((c) => String(c).toLowerCase().trim());
    const srCol = headerRow.findIndex((c) => c.includes("sr"));
    const partCol = headerRow.findIndex((c) => c.includes("particular"));
    const hsnCol = headerRow.findIndex((c) => c.includes("hsn"));
    const gstCol = headerRow.findIndex((c) => c.includes("gst"));
    const qtyCol = headerRow.findIndex((c) => c.includes("qty"));
    const netRateCol = headerRow.findIndex((c) => c.includes("net rate"));
    const rateCol = headerRow.findIndex((c) => c === "rate" || c.includes("base"));
    const amtCol = headerRow.findIndex((c) => c.includes("amount"));

    for (let i = invoiceHeaderIndex + 1; i < grid.length; i++) {
      const r = (grid[i] as unknown[]) || [];
      const srVal = srCol >= 0 ? String(r[srCol] || "").replace(".", "").trim() : "";
      const particulars = partCol >= 0 ? String(r[partCol] || "").trim() : "";

      if (!particulars || particulars.toLowerCase().includes("total") || particulars.toLowerCase().includes("cgst")) {
        continue;
      }

      // Must have numeric Sr or non-empty particulars
      const srNum = Number(srVal) || rows.length + 1;
      const hsn = hsnCol >= 0 ? String(r[hsnCol] || "").trim() : "";
      const gst = gstCol >= 0 ? Number(r[gstCol]) || 18 : 18;
      const qty = qtyCol >= 0 ? Math.max(0, Number(r[qtyCol]) || 0) : 50;
      const netRate = netRateCol >= 0 ? Math.max(0, Number(r[netRateCol]) || 0) : 0;
      const baseRate = rateCol >= 0 ? Math.max(0, Number(r[rateCol]) || 0) : netRate;
      const amount = amtCol >= 0 ? Number(r[amtCol]) || 0 : netRate * qty;

      const category = "Stationery";
      const sku = billNo ? `STA-${billNo}-${String(srNum).padStart(3, "0")}` : `STA-INV-${String(srNum).padStart(3, "0")}`;

      // Extract MRP if mentioned in parentheses e.g. ( ₹60 ) or ₹50
      let mrp = netRate;
      const mrpMatch = particulars.match(/₹\s*(\d+(?:\.\d+)?)/);
      if (mrpMatch) {
        mrp = Number(mrpMatch[1]);
      } else {
        const parenMatch = particulars.match(/\(\s*(\d+(?:\.\d+)?)\s*\)/);
        if (parenMatch) mrp = Number(parenMatch[1]);
      }
      if (mrp < netRate) mrp = Math.ceil(netRate * 1.1);

      const unit = detectUnit(particulars, category);
      const icon = detectIcon(particulars, category);

      rows.push({
        sku,
        name: particulars,
        category,
        description: `HSN: ${hsn || "9608"} • GST: ${gst}% • Base: ₹${baseRate}`,
        price: netRate || baseRate || 10,
        mrp: mrp || netRate || 10,
        stock: qty,
        unit,
        icon,
        imageUrl: "",
        active: true,
        hsn,
        gstPercent: gst,
        netRate,
        baseRate,
        invoiceNo: billNo || undefined,
        metadata: {
          srNo: srNum,
          particulars,
          hsn,
          gstPercent: gst,
          netRate,
          baseRate,
          lineAmount: amount,
          invoiceNo: billNo,
          invoiceDate: billDate,
          supplierName,
          supplierGstin,
          buyerName,
        },
      });
    }

    return { rows, invoiceMetadata, warnings };
  }

  // Case 2: Standard Key-Value / Column Spreadsheet
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const normalizedMap: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(raw)) {
      normalizedMap[normalizeHeader(key)] = val;
    }

    const sku = String(
      normalizedMap.sku ||
      normalizedMap.itemcode ||
      normalizedMap.code ||
      normalizedMap.id ||
      `ITEM-${String(i + 1).padStart(3, "0")}`
    ).trim().toUpperCase();

    const name = String(
      normalizedMap.name ||
      normalizedMap.particulars ||
      normalizedMap.itemname ||
      normalizedMap.product ||
      normalizedMap.productname ||
      normalizedMap.title ||
      ""
    ).trim();

    if (!name) {
      warnings.push(`Row ${i + 2}: skipped because item name was empty`);
      continue;
    }

    const category = String(
      normalizedMap.category ||
      normalizedMap.categoryname ||
      normalizedMap.type ||
      "Medicine"
    ).trim() || "Medicine";

    const hsn = String(normalizedMap.hsn || normalizedMap.hsnsac || "").trim();
    const gstPercent = Number(normalizedMap.gst || normalizedMap.gstpercent || normalizedMap.tax || 0) || undefined;

    const rawNetRate = normalizedMap.netrate ?? normalizedMap.price ?? normalizedMap.rate ?? normalizedMap.cost ?? 0;
    const price = Math.max(0, Number(rawNetRate) || 0);

    const rawBaseRate = normalizedMap.baserate ?? normalizedMap.rate ?? price;
    const baseRate = Number(rawBaseRate) || price;

    const rawMrp = normalizedMap.mrp ?? normalizedMap.originalprice ?? normalizedMap.mrprupees ?? price;
    const mrp = Math.max(price, Number(rawMrp) || price);

    const rawStock = normalizedMap.stock ?? normalizedMap.quantity ?? normalizedMap.qty ?? normalizedMap.units ?? 50;
    const stock = Math.max(0, Number(rawStock) || 0);

    const unit = String(
      normalizedMap.unit ||
      normalizedMap.units ||
      normalizedMap.packaging ||
      detectUnit(name, category)
    ).trim();

    const icon = String(
      normalizedMap.icon ||
      normalizedMap.emoji ||
      detectIcon(name, category)
    ).trim();

    const imageUrl = String(
      normalizedMap.image ||
      normalizedMap.imageurl ||
      normalizedMap.photo ||
      normalizedMap.picture ||
      ""
    ).trim();

    const invoiceNo = String(normalizedMap.invoiceno || normalizedMap.billno || "").trim() || undefined;

    const rawActive = normalizedMap.active ?? normalizedMap.status ?? normalizedMap.enabled;
    const active =
      rawActive === undefined ||
      rawActive === "" ||
      String(rawActive).toLowerCase() === "true" ||
      rawActive === 1 ||
      String(rawActive).toLowerCase() === "active" ||
      String(rawActive).toLowerCase() === "yes";

    const description = String(
      normalizedMap.description ||
      normalizedMap.desc ||
      normalizedMap.details ||
      (hsn ? `HSN: ${hsn}` : "")
    ).trim();

    rows.push({
      sku,
      name,
      category,
      description,
      price,
      mrp,
      stock,
      unit,
      icon: icon || "📦",
      imageUrl,
      active,
      hsn: hsn || undefined,
      gstPercent,
      netRate: price,
      baseRate,
      invoiceNo,
      metadata: {
        rawFields: raw,
        importedAt: new Date().toISOString(),
      },
    });
  }

  return { rows, invoiceMetadata, warnings };
}

export async function POST(request: Request) {
  const rateLimitResponse = applyRateLimit(request, "bulk");
  if (rateLimitResponse) return rateLimitResponse;

  try {
    let rows: ParsedItem[] = [];
    let invoiceMetadata: Record<string, unknown> | undefined;
    let warnings: string[] = [];

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");

      if (!file || !(file instanceof Blob)) {
        return Response.json({ error: "No Excel or CSV file provided in upload" }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const extracted = extractRowsFromWorkbook(buffer);
      rows = extracted.rows;
      invoiceMetadata = extracted.invoiceMetadata;
      warnings = extracted.warnings;
    } else if (contentType.includes("application/json")) {
      const body = await request.json();
      if (body.fileBase64) {
        const base64Data = body.fileBase64.replace(/^data:.*?;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");
        const extracted = extractRowsFromWorkbook(buffer);
        rows = extracted.rows;
        invoiceMetadata = extracted.invoiceMetadata;
        warnings = extracted.warnings;
      } else if (Array.isArray(body.items)) {
        rows = body.items
          .map((item: Partial<ParsedItem>, idx: number) => ({
            sku: String(item.sku || `ITEM-${idx + 1}`).trim().toUpperCase(),
            name: String(item.name || "").trim(),
            category: String(item.category || "General").trim(),
            description: String(item.description || "").trim(),
            price: Math.max(0, Number(item.price) || 0),
            mrp: Math.max(Number(item.price) || 0, Number(item.mrp) || Number(item.price) || 0),
            stock: Math.max(0, Number(item.stock) || 0),
            unit: String(item.unit || "piece").trim(),
            icon: String(item.icon || "📦").trim(),
            imageUrl: String(item.imageUrl || "").trim(),
            active: item.active !== false,
            hsn: item.hsn,
            gstPercent: item.gstPercent,
            netRate: item.netRate,
            baseRate: item.baseRate,
            invoiceNo: item.invoiceNo,
            metadata: item.metadata,
          }))
          .filter((i: ParsedItem) => Boolean(i.name));
      } else {
        return Response.json({ error: "Invalid format: provide 'file', 'items' array or 'fileBase64'" }, { status: 400 });
      }
    } else {
      return Response.json({ error: "Unsupported Content-Type. Use multipart/form-data or application/json" }, { status: 415 });
    }

    if (!rows.length) {
      return Response.json({ error: "No valid inventory rows found in the uploaded file" }, { status: 400 });
    }

    const now = new Date();

    if (!process.env.MONGODB_URI) {
      const savedItems = bulkUpsertLocalInventory(
        rows.map((r) => ({
          ...r,
          source: r.invoiceNo ? "excel_invoice" : "excel",
        }))
      );

      return Response.json({
        success: true,
        message: `Successfully processed ${rows.length} items with metadata (Local Prototype)`,
        total: rows.length,
        itemsCount: savedItems.length,
        items: savedItems,
        invoiceMetadata,
        warnings,
        source: "local_prototype",
      });
    }

    const db = await getDb();
    await ensureCollections(db);
    const collection = db.collection("inventory");

    const bulkOps = rows.map((item) => ({
      updateOne: {
        filter: { sku: item.sku },
        update: {
          $set: {
            sku: item.sku,
            name: item.name,
            category: item.category,
            description: item.description,
            price: item.price,
            mrp: item.mrp,
            stock: item.stock,
            unit: item.unit,
            icon: item.icon,
            imageUrl: item.imageUrl,
            active: item.active,
            source: item.invoiceNo ? "excel_invoice" : "excel",
            version: 1,
            ...(item.hsn ? { hsn: item.hsn } : {}),
            ...(item.gstPercent !== undefined ? { gstPercent: item.gstPercent } : {}),
            ...(item.netRate !== undefined ? { netRate: item.netRate } : {}),
            ...(item.baseRate !== undefined ? { baseRate: item.baseRate } : {}),
            ...(item.invoiceNo ? { invoiceNo: item.invoiceNo } : {}),
            ...(item.metadata ? { metadata: item.metadata } : {}),
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        upsert: true,
      },
    }));

    const bulkResult = await collection.bulkWrite(bulkOps, { ordered: false });
    const savedDocs = await collection.find({ sku: { $in: rows.map((r) => r.sku) } }).toArray();

    return Response.json({
      success: true,
      message: `Successfully dumped and synced ${rows.length} items with full metadata to MongoDB cluster ('inventory' collection)`,
      total: rows.length,
      insertedCount: bulkResult.upsertedCount,
      modifiedCount: bulkResult.modifiedCount,
      matchedCount: bulkResult.matchedCount,
      collection: "inventory",
      invoiceMetadata,
      items: savedDocs.map(({ _id, ...doc }) => ({ id: _id.toString(), ...doc })),
      warnings,
      source: "mongodb_cluster",
    });
  } catch (error) {
    console.error("POST /api/inventory/bulk-upload error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to bulk upload inventory sheet" },
      { status: 500 }
    );
  }
}
