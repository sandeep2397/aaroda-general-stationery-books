export type Category = "Medicine" | "Stationery";
export type InventoryItem = {
  sku: string; name: string; category: Category; description: string;
  price: number; mrp: number; stock: number; unit: string; icon: string;
  active: boolean; source: "seed" | "excel"; createdAt: Date; updatedAt: Date;
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
].map(([sku,name,category,description,price,mrp,stock,unit,icon]) => ({ sku,name,category,description,price,mrp,stock,unit,icon,active:true,source:"seed",createdAt:now(),updatedAt:now() } as InventoryItem));
