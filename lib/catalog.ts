export type Category = "Medicine" | "Stationery" | string;

export type InventoryItem = {
  id?: string;
  _id?: unknown;
  sku: string;
  name: string;
  category: Category;
  description: string;
  price: number;
  mrp: number;
  stock: number;
  unit: string;
  icon: string;
  imageUrl?: string;
  active: boolean;
  source: "seed" | "excel" | "admin" | "excel_invoice" | string;
  version: number;
  hsn?: string;
  gstPercent?: number;
  netRate?: number;
  baseRate?: number;
  invoiceNo?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

const now = () => new Date();
export const seedInventory: InventoryItem[] = [
  ["MED-001","Paracetamol 500mg","Medicine","10 tablets • Dolo",32,35,60,"strip","💊"],
  ["MED-002","Cetirizine 10mg","Medicine","10 tablets • Generic",24,28,45,"strip","💊"],
  ["MED-003","Digene Mint","Medicine","15 tablets • Abbott",29,32,38,"strip","🧴"],
  ["MED-004","Band-Aid Washproof","Medicine","10 strips • J&J",45,50,25,"pack","🩹"],
  ["MED-005","Vitamin C 500mg","Medicine","15 tablets • Limcee",38,42,52,"strip","🍊"],
  ["STA-001","Classmate Notebook","Stationery","172 pages • Ruled",65,70,32,"piece","📓"],
  ["STA-002","Blue Ball Pens","Stationery","Pack of 5 • Reynolds",50,55,40,"pack","🖊️"],
  ["STA-003","Apsara Pencils","Stationery","Pack of 10 • Extra dark",55,60,35,"pack","✏️"],
  ["STA-004","Sticky Notes","Stationery","100 sheets • Yellow",42,48,20,"pack","🗒️"],
  ["STA-005","Geometry Box","Stationery","8-piece student set",110,125,16,"piece","📐"],
].map(([sku,name,category,description,price,mrp,stock,unit,icon]) => ({
  sku: sku as string,
  name: name as string,
  category: category as Category,
  description: description as string,
  price: price as number,
  mrp: mrp as number,
  stock: stock as number,
  unit: unit as string,
  icon: icon as string,
  imageUrl: "",
  active: true,
  source: "seed",
  version: 1,
  createdAt: now(),
  updatedAt: now()
} as InventoryItem));

declare global {
  var nammaLocalInventory: InventoryItem[] | undefined;
}

export function getLocalInventory(): InventoryItem[] {
  if (!global.nammaLocalInventory) {
    global.nammaLocalInventory = seedInventory.map((item, index) => ({
      ...item,
      id: `local-${index + 1}`,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  }
  return global.nammaLocalInventory;
}

export function upsertLocalInventoryItem(item: Partial<InventoryItem> & { sku: string; name: string }): InventoryItem {
  const list = getLocalInventory();
  const existingIndex = list.findIndex((i) => i.sku.toLowerCase() === item.sku.trim().toLowerCase());
  const currentTime = new Date();
  const currentVersion = existingIndex >= 0 ? (list[existingIndex].version || 1) : 1;

  const normalized: InventoryItem = {
    id: existingIndex >= 0 ? list[existingIndex].id : `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sku: item.sku.trim().toUpperCase(),
    name: item.name.trim(),
    category: item.category || "General",
    description: item.description || "",
    price: Number(item.price) || 0,
    mrp: Number(item.mrp) || Number(item.price) || 0,
    stock: Number(item.stock) || 0,
    unit: item.unit || "piece",
    icon: item.icon || (item.category === "Medicine" ? "💊" : item.category === "Stationery" ? "✏️" : "📦"),
    imageUrl: item.imageUrl || "",
    active: item.active !== false,
    source: item.source || "admin",
    version: existingIndex >= 0 ? currentVersion + 1 : 1,
    hsn: item.hsn,
    gstPercent: item.gstPercent,
    netRate: item.netRate,
    baseRate: item.baseRate,
    invoiceNo: item.invoiceNo,
    metadata: item.metadata,
    createdAt: existingIndex >= 0 ? list[existingIndex].createdAt : currentTime,
    updatedAt: currentTime,
  };

  if (existingIndex >= 0) {
    list[existingIndex] = { ...list[existingIndex], ...normalized };
    return list[existingIndex];
  } else {
    list.unshift(normalized);
    return normalized;
  }
}

export function bulkUpsertLocalInventory(items: Array<Partial<InventoryItem> & { sku: string; name: string }>): InventoryItem[] {
  return items.map((item) => upsertLocalInventoryItem(item));
}

export function deleteLocalInventoryItem(skuOrId: string): boolean {
  const list = getLocalInventory();
  const index = list.findIndex((i) => i.sku.toLowerCase() === skuOrId.toLowerCase() || i.id === skuOrId);
  if (index >= 0) {
    list.splice(index, 1);
    return true;
  }
  return false;
}


