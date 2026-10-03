"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useState, useEffect, useRef, ChangeEvent, DragEvent, FormEvent } from "react";
import * as XLSX from "xlsx";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { firebaseStorage } from "@/lib/firebase";
import { toast } from "react-toastify";
import InventoryEditModal from "@/components/InventoryEditModal";

export type AdminProduct = {
  id?: string;
  _id?: string;
  sku: string;
  name: string;
  category: string;
  description: string;
  price: number;
  mrp: number;
  stock: number;
  unit: string;
  icon: string;
  imageUrl?: string;
  imageUrls?: string[];
  imageMetadata?: Array<Record<string, unknown>>;
  active: boolean;
  source?: string;
  version?: number;
  hsn?: string;
  gstPercent?: number;
  netRate?: number;
  baseRate?: number;
  invoiceNo?: string;
  metadata?: Record<string, unknown>;
};

interface MongoHealthData {
  status: "healthy" | "unconfigured" | "unavailable" | "degraded" | "local_prototype";
  database: string;
  latencyMs: number;
  pool?: {
    minPoolSize: number;
    maxPoolSize: number;
    active: boolean;
    connectedSince?: string;
  };
  lastPingAt?: string;
  stats?: {
    success: number;
    errors: number;
  };
  message?: string;
  reason?: string;
}

interface AdminDashboardProps {
  onSwitchToStore?: () => void;
  onInventoryUpdated?: () => void;
  userId?: string;
}

type AdminOrder = { id: string; orderNumber: string; userId: string; customer?: { name?: string; email?: string }; summary?: { itemCount?: number; unitCount?: number }; total: number; currency?: string; paymentStatus: string; paymentMethod?: string; orderStatus: string; createdAt: string };
type AdminPayment = { id: string; orderId: string; orderNumber?: string; userId: string; amount: number; currency?: string; paymentMethod: string; paymentStatus: string; paymentReferenceId?: string; createdAt: string };
type ActivityStats = { inventoryCount: number; orderCount: number; paymentCount: number; successfulPayments: number; successfulRevenue: number; awaitingPayment: number; expiredOrders: number };

const EMOJI_OPTIONS = ["💊", "🧴", "🩹", "🍊", "📓", "🖊️", "✏️", "🗒️", "📐", "🧪", "🧼", "📦", "🩺", "💉", "🧻", "🍵"];
const CATEGORY_OPTIONS = ["Medicine", "Stationery", "Personal Care", "First Aid", "General"];

export default function AdminDashboard({ onSwitchToStore, onInventoryUpdated, userId }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<"catalog" | "orders" | "add" | "excel" | "health">("catalog");
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [inventoryStats, setInventoryStats] = useState({ totalSkus: 0, totalStock: 0, medicines: 0, stationery: 0 });
  const [statsLoading, setStatsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<{ sku: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedSkus, setSelectedSkus] = useState<string[]>([]);
  const [editCandidate, setEditCandidate] = useState<AdminProduct | null>(null);
  const [activityStats, setActivityStats] = useState<ActivityStats | null>(null);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);

  // Health state
  const [health, setHealth] = useState<MongoHealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // New item form state
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Medicine");
  const [customCategory, setCustomCategory] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState<number | "">("");
  const [mrp, setMrp] = useState<number | "">("");
  const [stock, setStock] = useState<number | "">(50);
  const [unit, setUnit] = useState("strip");
  const [icon, setIcon] = useState("💊");
  const [imageUrl, setImageUrl] = useState("");
  const [active, setActive] = useState(true);
  const [savingItem, setSavingItem] = useState(false);

  // Excel Bulk Upload State
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<AdminProduct[]>([]);
  const [excelWarnings, setExcelWarnings] = useState<string[]>([]);
  const [uploadingExcel, setUploadingExcel] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch inventory
  const fetchInventory = async () => {
    setLoading(true);
    setStatsLoading(true);
    try {
      const res = await fetch("/api/inventory?admin=true&limit=100");
      const data = await res.json();
      if (data.items) {
        setProducts(data.items);
      }
      const statsResponse = await fetch("/api/inventory?stats=true");
      if (statsResponse.ok) setInventoryStats(await statsResponse.json());
    } catch (err) {
      console.error("Failed to load inventory:", err);
    } finally {
      setLoading(false);
      setStatsLoading(false);
    }
  };

  // Fetch health
  const fetchHealth = async () => {
    setHealthLoading(true);
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      setHealth(data.mongo || null);
    } catch (err) {
      console.error("Failed to ping health:", err);
    } finally {
      setHealthLoading(false);
    }
  };

  const fetchOrderActivity = async () => {
    setActivityLoading(true);
    try {
      const response = await fetch("/api/admin/dashboard", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load orders");
      setActivityStats(data.stats);
      setOrders(data.orders || []);
      setPayments(data.payments || []);
    } catch (error) {
      console.error("Failed to load order activity:", error);
      toast.error(error instanceof Error ? error.message : "Unable to load order activity");
    } finally { setActivityLoading(false); }
  };

  useEffect(() => {
    fetchInventory();
    fetchHealth();
    fetchOrderActivity();
    const interval = setInterval(fetchHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  // Auto generate SKU based on category
  const generateSku = (cat: string) => {
    const prefix = cat.toLowerCase().includes("med") ? "MED" : cat.toLowerCase().includes("stat") ? "STA" : "ITEM";
    const rand = Math.floor(100 + Math.random() * 900);
    setSku(`${prefix}-${rand}`);
  };

  // Handle Image Upload & convert to Data URL
  const handleImageFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setStatusMessage({ type: "error", text: "Please upload a valid image file (PNG, JPG, SVG, WebP)" });
      return;
    }
    if (!userId || !firebaseStorage) { setStatusMessage({ type: "error", text: "Sign in with Firebase before uploading product images." }); return; }
    try {
      setStatusMessage({ type: "info", text: "Uploading image securely to Firebase Storage…" });
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const storageRef = ref(firebaseStorage, `inventory/${userId}/${Date.now()}-${safeName}`);
      const task = uploadBytesResumable(storageRef, file, { contentType: file.type });
      await new Promise<void>((resolve, reject) => task.on("state_changed", undefined, reject, resolve));
      setImageUrl(await getDownloadURL(task.snapshot.ref));
      setStatusMessage({ type: "success", text: "Image uploaded to Firebase Storage." });
    } catch (err) { setStatusMessage({ type: "error", text: err instanceof Error ? err.message : "Image upload failed." }); }
  };

  // Handle Add Item Submit
  const handleAddItem = async (e: FormEvent) => {
    e.preventDefault();
    if (!sku.trim() || !name.trim() || price === "") {
      setStatusMessage({ type: "error", text: "SKU, Name, and Price are required fields" });
      return;
    }

    setSavingItem(true);
    setStatusMessage(null);

    const effectiveCategory = category === "Custom" ? (customCategory.trim() || "General") : category;

    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: sku.trim(),
          name: name.trim(),
          category: effectiveCategory,
          description: description.trim(),
          price: Number(price),
          mrp: mrp === "" ? Number(price) : Number(mrp),
          stock: stock === "" ? 0 : Number(stock),
          unit: unit.trim() || "piece",
          icon,
          imageUrl,
          active,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save item");

      setStatusMessage({
        type: "success",
        text: `Item "${name}" successfully saved into MongoDB collection 'inventory'!`,
      });
      toast.success(`Saved ${name} successfully.`);

      // Reset form
      setSku("");
      setName("");
      setDescription("");
      setPrice("");
      setMrp("");
      setStock(50);
      setImageUrl("");

      await fetchInventory();
      onInventoryUpdated?.();
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Error saving item",
      });
      toast.error(err instanceof Error ? err.message : "Error saving item");
    } finally {
      setSavingItem(false);
    }
  };

  // Parse Excel file client-side for instant preview
  const parseExcelFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("No sheet found in Excel file");

      const sheet = workbook.Sheets[sheetName];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });

      const warnings: string[] = [];
      const parsed: AdminProduct[] = [];

      let invoiceHeaderIndex = -1;
      let billNo = "";
      for (let i = 0; i < Math.min(25, grid.length); i++) {
        const row = (grid[i] as string[]) || [];
        const rowText = row.map(String).join(" ");
        if (rowText.includes("Bill No")) {
          const idx = row.findIndex((c) => String(c).includes("Bill No"));
          if (idx >= 0 && row[idx + 1]) billNo = String(row[idx + 1]).trim();
        }
        if (row.some((c) => String(c).toLowerCase().includes("particulars") || String(c).toLowerCase().includes("sr."))) {
          invoiceHeaderIndex = i;
          break;
        }
      }

      if (invoiceHeaderIndex >= 0) {
        const headerRow = (grid[invoiceHeaderIndex] as string[]).map((c) => String(c).toLowerCase().trim());
        const srCol = headerRow.findIndex((c) => c.includes("sr"));
        const partCol = headerRow.findIndex((c) => c.includes("particular"));
        const hsnCol = headerRow.findIndex((c) => c.includes("hsn"));
        const gstCol = headerRow.findIndex((c) => c.includes("gst"));
        const qtyCol = headerRow.findIndex((c) => c.includes("qty"));
        const netRateCol = headerRow.findIndex((c) => c.includes("net rate"));
        const rateCol = headerRow.findIndex((c) => c === "rate" || c.includes("base"));

        for (let i = invoiceHeaderIndex + 1; i < grid.length; i++) {
          const r = (grid[i] as unknown[]) || [];
          const srVal = srCol >= 0 ? String(r[srCol] || "").replace(".", "").trim() : "";
          const particulars = partCol >= 0 ? String(r[partCol] || "").trim() : "";

          if (!particulars || particulars.toLowerCase().includes("total") || particulars.toLowerCase().includes("cgst")) {
            continue;
          }

          const srNum = Number(srVal) || parsed.length + 1;
          const hsn = hsnCol >= 0 ? String(r[hsnCol] || "").trim() : "";
          const gst = gstCol >= 0 ? Number(r[gstCol]) || 18 : 18;
          const qty = qtyCol >= 0 ? Math.max(0, Number(r[qtyCol]) || 0) : 50;
          const netRate = netRateCol >= 0 ? Math.max(0, Number(r[netRateCol]) || 0) : 0;
          const baseRate = rateCol >= 0 ? Math.max(0, Number(r[rateCol]) || 0) : netRate;

          const category = "Stationery";
          const sku = billNo ? `STA-${billNo}-${String(srNum).padStart(3, "0")}` : `STA-INV-${String(srNum).padStart(3, "0")}`;

          parsed.push({
            sku,
            name: particulars,
            category,
            description: `HSN: ${hsn || "9608"} • GST: ${gst}% • Base: ₹${baseRate}`,
            price: netRate || baseRate || 10,
            mrp: netRate || baseRate || 10,
            stock: qty,
            unit: "piece",
            icon: particulars.toLowerCase().includes("pen") ? "🖊️" : particulars.toLowerCase().includes("pencil") ? "✏️" : "📓",
            imageUrl: "",
            active: true,
            hsn,
            gstPercent: gst,
            netRate,
            baseRate,
            invoiceNo: billNo || undefined,
            source: "excel_invoice",
          });
        }
      } else {
        const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        rawRows.forEach((row, i) => {
          const norm: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) {
            norm[k.toLowerCase().replace(/[^a-z0-9]/g, "")] = v;
          }

          const rowSku = String(norm.sku || norm.itemcode || norm.code || `ITEM-${100 + i}`).trim().toUpperCase();
          const rowName = String(norm.name || norm.particulars || norm.itemname || norm.product || "").trim();
          const rowCategory = String(norm.category || norm.type || "Medicine").trim() || "Medicine";
          const rowDesc = String(norm.description || norm.desc || norm.details || "").trim();
          const rowPrice = Number(norm.price ?? norm.netrate ?? norm.rate ?? 0) || 0;
          const rowMrp = Number(norm.mrp ?? norm.originalprice ?? rowPrice) || rowPrice;
          const rowStock = Number(norm.stock ?? norm.quantity ?? norm.qty ?? 50) || 0;
          const rowUnit = String(norm.unit || norm.units || "piece").trim() || "piece";
          const rowIcon = String(norm.icon || norm.emoji || (rowCategory.toLowerCase().includes("med") ? "💊" : "✏️")).trim();
          const rowImage = String(norm.image || norm.imageurl || "").trim();
          const rowActive = norm.active === undefined || norm.active === "" || String(norm.active).toLowerCase() === "true";

          if (!rowName) {
            warnings.push(`Row ${i + 2}: Skipped (Missing item name)`);
            return;
          }

          parsed.push({
            sku: rowSku,
            name: rowName,
            category: rowCategory,
            description: rowDesc,
            price: rowPrice,
            mrp: rowMrp,
            stock: rowStock,
            unit: rowUnit,
            icon: rowIcon,
            imageUrl: rowImage,
            active: rowActive,
            source: "excel",
          });
        });
      }

      setParsedRows(parsed);
      setExcelWarnings(warnings);
      setExcelFile(file);
      setStatusMessage({
        type: "info",
        text: `Excel loaded: ${parsed.length} items parsed and ready to add to MongoDB cluster.`,
      });
      toast.info(`Excel parsed: ${parsed.length} items ready to upload.`);
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to parse Excel file",
      });
      toast.error(err instanceof Error ? err.message : "Bulk upload failed");
    }
  };

  // Drag & Drop handlers
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) parseExcelFile(file);
  };

  // Submit Bulk Upload to MongoDB Collection
  const handleSyncExcelToMongo = async () => {
    if (!excelFile && !parsedRows.length) {
      setStatusMessage({ type: "error", text: "No parsed rows to upload. Please select an Excel file first." });
      return;
    }

    setUploadingExcel(true);
    setStatusMessage(null);

    try {
      let res: Response;
      if (excelFile) {
        const formData = new FormData();
        formData.append("file", excelFile);
        res = await fetch("/api/inventory/bulk-upload", {
          method: "POST",
          body: formData,
        });
      } else {
        res = await fetch("/api/inventory/bulk-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: parsedRows }),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk upload failed");

      setStatusMessage({
        type: "success",
        text: `✓ Success! Dumped and synced ${data.total || parsedRows.length} items with full metadata into MongoDB collection 'inventory'!`,
      });
      toast.success(`Bulk upload completed: ${data.total || parsedRows.length} items.`);

      // Clear excel upload state
      setParsedRows([]);
      setExcelFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

      await fetchInventory();
      onInventoryUpdated?.();
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Bulk upload failed",
      });
      toast.error(err instanceof Error ? err.message : "Bulk upload failed");
    } finally {
      setUploadingExcel(false);
    }
  };

  // Adjust stock inline with Optimistic Locking support
  const handleQuickStock = async (sku: string, delta: number, currentStock: number, version?: number) => {
    const newStock = Math.max(0, currentStock + delta);
    try {
      const res = await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, stock: newStock, version }),
      });

      if (res.status === 409) {
        const errData = await res.json();
        setStatusMessage({
          type: "error",
          text: `⚠️ Optimistic Lock Conflict: ${errData.error} Reloading latest inventory.`,
        });
        await fetchInventory();
        return;
      }

      if (res.ok) {
        setProducts((prev) => prev.map((p) => (p.sku === sku ? { ...p, stock: newStock, version: (p.version || 1) + 1 } : p)));
        onInventoryUpdated?.();
        toast.success("Stock updated.");
      }
    } catch (err) {
      console.error("Stock update failed:", err);
      toast.error("Stock update failed.");
    }
  };

  // Delete item
  const handleDeleteItem = async () => {
    if (!deleteCandidate) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/inventory?sku=${encodeURIComponent(deleteCandidate.sku)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setProducts((prev) => prev.filter((p) => p.sku !== deleteCandidate.sku));
        setStatusMessage({ type: "success", text: `Deleted "${deleteCandidate.name}" from inventory.` });
        toast.success(`Deleted ${deleteCandidate.name}.`);
        onInventoryUpdated?.();
        setDeleteCandidate(null);
      } else {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete item.");
      }
    } catch (err) {
      setStatusMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to delete item." });
      toast.error(err instanceof Error ? err.message : "Failed to delete item.");
    } finally {
      setDeleting(false);
    }
  };
  const handleBulkDelete = async () => { if (!selectedSkus.length) return; if (!window.confirm(`Delete ${selectedSkus.length} selected items?`)) return; try { const res = await fetch("/api/inventory?bulk=true", { method:"DELETE", headers:{"Content-Type":"application/json"}, body:JSON.stringify({skus:selectedSkus}) }); const data=await res.json(); if(!res.ok) throw new Error(data.error); setProducts(prev=>prev.filter(item=>!selectedSkus.includes(item.sku))); setSelectedSkus([]); setStatusMessage({type:"success",text:`Deleted ${data.deletedCount} selected item(s).`}); onInventoryUpdated?.(); } catch(err){setStatusMessage({type:"error",text:err instanceof Error?err.message:"Bulk delete failed."})} };

  // Filtered products list
  const filteredProducts = products.filter((p) => {
    const matchesCat = selectedCategory === "All" || p.category.toLowerCase() === selectedCategory.toLowerCase();
    const matchesSearch =
      !search ||
      `${p.name} ${p.sku} ${p.description} ${p.category}`.toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const totalStock = inventoryStats.totalStock;

  return (
    <div className="admin-shell">
      {/* Top Header */}
      <div className="admin-header">
        <div className="admin-title">
          <h1>Aaroda Books and Stationery — Admin & Inventory</h1>
          <p>Manage real-time inventory in the MongoDB cluster, add items with images, and bulk upload Excel sheets.</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-secondary" onClick={onSwitchToStore}>
            🛍️ Go to Customer Store
          </button>
        </div>
      </div>

      {/* Live Status Alert */}
      {statusMessage && (
        <div className={`alert alert-${statusMessage.type}`}>
          <span>{statusMessage.text}</span>
          <button
            className="text-gray-500 hover:text-black font-bold ml-4"
            onClick={() => setStatusMessage(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Stats Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Inventory</span>
          <span className="stat-value">{statsLoading ? <span className="skeleton stat-skeleton" /> : inventoryStats.totalSkus}</span>
          <span className="stat-meta">{statsLoading ? <span className="skeleton stat-skeleton small" /> : `${totalStock} total units in stock`}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Orders</span>
          <span className="stat-value">{activityLoading ? <span className="skeleton stat-skeleton" /> : activityStats?.orderCount || 0}</span>
          <span className="stat-meta">{activityLoading ? <span className="skeleton stat-skeleton small" /> : `${activityStats?.awaitingPayment || 0} awaiting payment · ${activityStats?.expiredOrders || 0} expired`}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Payments</span>
          <span className="stat-value">{activityLoading ? <span className="skeleton stat-skeleton" /> : activityStats?.successfulPayments || 0}</span>
          <span className="stat-meta">{activityLoading ? <span className="skeleton stat-skeleton small" /> : `₹${activityStats?.successfulRevenue || 0} captured · ${activityStats?.paymentCount || 0} records`}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">MongoDB Cluster</span>
          <span className="stat-value flex items-center gap-2">
            <span
              className={`status-dot ${
                health?.status === "healthy"
                  ? "healthy"
                  : health?.status === "unconfigured"
                  ? "prototype"
                  : "degraded"
              }`}
            />
            <span className="text-base font-bold">
              {health?.status === "healthy"
                ? "Connected"
                : health?.status === "unconfigured"
                ? "Prototype"
                : "Degraded"}
            </span>
          </span>
          <span className="stat-meta">
            {health?.latencyMs !== undefined ? `${health.latencyMs}ms latency` : "Pooling active"} • Pool: min 5 / max 20
          </span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="admin-tabs">
        <button
          className={`admin-tab ${activeTab === "catalog" ? "active" : ""}`}
          onClick={() => setActiveTab("catalog")}
        >
          📦 Inventory List ({products.length})
        </button>
        <button
          className={`admin-tab ${activeTab === "orders" ? "active" : ""}`}
          onClick={() => { setActiveTab("orders"); fetchOrderActivity(); }}
        >
          🧾 Orders & Payments ({activityStats?.orderCount || 0})
        </button>
        <button
          className={`admin-tab ${activeTab === "add" ? "active" : ""}`}
          onClick={() => setActiveTab("add")}
        >
          ➕ Add New Item
        </button>
        <button
          className={`admin-tab ${activeTab === "excel" ? "active" : ""}`}
          onClick={() => setActiveTab("excel")}
        >
          📤 Bulk Excel Upload
        </button>
        <button
          className={`admin-tab ${activeTab === "health" ? "active" : ""}`}
          onClick={() => setActiveTab("health")}
        >
          🩺 MongoDB Pooling & Health
        </button>
      </div>

      {/* TAB 1: INVENTORY CATALOG */}
      {activeTab === "catalog" && (
        <div className="admin-card">
          <div className="admin-card-header">
            <h2>📦 Current Inventory in MongoDB Collection (&apos;inventory&apos;)</h2>
            <div className="flex gap-2 flex-wrap items-center">
              <input
                type="text"
                placeholder="Search items, SKU, category..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
              />
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm bg-white"
              >
                <option value="All">All Categories</option>
                <option value="Medicine">Medicine</option>
                <option value="Stationery">Stationery</option>
                <option value="Personal Care">Personal Care</option>
                <option value="First Aid">First Aid</option>
                <option value="General">General</option>
              </select>
              <button className="btn-secondary text-xs" onClick={fetchInventory}>
                🔄 Refresh
              </button>
              {selectedSkus.length > 0 && <button className="btn-outline-danger" onClick={handleBulkDelete}>Delete selected ({selectedSkus.length})</button>}
            </div>
          </div>

          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label="Select all" checked={filteredProducts.length>0 && selectedSkus.length===filteredProducts.length} onChange={e=>setSelectedSkus(e.target.checked?filteredProducts.map(p=>p.sku):[])}/></th>
                  <th>Item</th>
                  <th>SKU</th>
                  <th>Category</th>
                  <th>HSN / Tax</th>
                  <th>Price (₹)</th>
                  <th>MRP (₹)</th>
                  <th>Stock</th>
                  <th>Unit</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-gray-500">
                      <div className="admin-table-skeleton" aria-label="Loading inventory" aria-busy="true">{Array.from({ length: 5 }, (_, index) => <span className="skeleton" key={index} />)}</div>
                    </td>
                  </tr>
                ) : filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-gray-500">
                      No items found matching your filters. Add an item or upload an Excel sheet.
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((item) => (
                    <tr key={item.sku || item.id}>
                      <td><input type="checkbox" aria-label={`Select ${item.name}`} checked={selectedSkus.includes(item.sku)} onChange={e=>setSelectedSkus(prev=>e.target.checked?[...prev,item.sku]:prev.filter(s=>s!==item.sku))}/></td>
                      <td>
                        <div className="flex items-center gap-2.5">
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt={item.name}
                              className="w-9 h-9 rounded-lg object-cover border border-gray-200"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-lg">
                              {item.icon || "📦"}
                            </div>
                          )}
                          <div>
                            <span className="font-bold text-gray-900 block">{item.name}</span>
                            <small className="text-gray-500 text-xs truncate max-w-xs block">{item.description}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="sku-tag">{item.sku}</span>
                      </td>
                      <td>
                        <span className="badge badge-blue">{item.category}</span>
                      </td>
                      <td className="text-xs text-gray-700">
                        {item.hsn ? (
                          <div>
                            <span className="font-mono">{item.hsn}</span>
                            {item.gstPercent !== undefined && (
                              <span className="text-emerald-700 font-semibold block">{item.gstPercent}% GST</span>
                            )}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="font-bold text-emerald-900">₹{item.price}</td>
                      <td className="text-gray-400 line-through text-xs">₹{item.mrp}</td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <button
                            className="w-6 h-6 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 font-bold flex items-center justify-center text-xs"
                            onClick={() => handleQuickStock(item.sku, -5, item.stock, item.version)}
                            title="-5 stock"
                          >
                            −
                          </button>
                          <span
                            className={`font-bold px-2 py-0.5 rounded text-xs ${
                              item.stock <= 5
                                ? "bg-red-100 text-red-800"
                                : item.stock <= 20
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            {item.stock}
                          </span>
                          <button
                            className="w-6 h-6 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 font-bold flex items-center justify-center text-xs"
                            onClick={() => handleQuickStock(item.sku, 5, item.stock, item.version)}
                            title="+5 stock"
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td className="text-xs text-gray-600">{item.unit}</td>
                      <td>
                        <span
                          className={`badge ${
                            item.active && item.stock > 0 ? "badge-green" : "badge-gray"
                          }`}
                        >
                          {item.active ? (item.stock > 0 ? "In Stock" : "Out of Stock") : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <button className="btn-secondary text-xs mr-2" onClick={() => setEditCandidate(item)}>Edit</button>
                        <button
                          className="btn-outline-danger"
                          onClick={() => setDeleteCandidate({ sku: item.sku, name: item.name })}
                          title="Delete Item"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "orders" && (
        <div className="admin-card">
          <div className="admin-card-header">
            <div><h2>🧾 Orders and successful payments</h2><p className="text-xs text-gray-500">Orders awaiting payment automatically expire after 10 minutes. The view refreshes their status before loading.</p></div>
            <button className="btn-secondary text-xs" onClick={fetchOrderActivity}>🔄 Refresh</button>
          </div>
          <h3 className="admin-subheading">Orders ({orders.length})</h3>
          <div className="table-responsive">
            <table className="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Created</th></tr></thead><tbody>
              {activityLoading ? <tr><td colSpan={7}><div className="admin-table-skeleton">{Array.from({ length: 5 }, (_, index) => <span className="skeleton" key={index} />)}</div></td></tr> : orders.length ? orders.map(order => <tr key={order.id}><td><b>{order.orderNumber}</b><small className="block text-gray-500">{order.paymentMethod || "razorpay"}</small></td><td>{order.customer?.name || "Guest"}<small className="block text-gray-500">{order.customer?.email || order.userId}</small></td><td>{order.summary?.unitCount || order.summary?.itemCount || 0}</td><td>₹{order.total}</td><td><span className="badge badge-blue">{order.paymentStatus}</span></td><td><span className={`badge ${order.orderStatus === "placed" ? "badge-green" : order.orderStatus === "expired" ? "badge-gray" : "badge-blue"}`}>{order.orderStatus}</span></td><td>{new Date(order.createdAt).toLocaleString()}</td></tr>) : <tr><td colSpan={7} className="text-center py-8 text-gray-500">No orders have been created yet.</td></tr>}
            </tbody></table>
          </div>
          <h3 className="admin-subheading">Payments ({payments.length})</h3>
          <div className="table-responsive">
            <table className="admin-table"><thead><tr><th>Reference</th><th>Order</th><th>User</th><th>Amount</th><th>Method</th><th>Status</th><th>Created</th></tr></thead><tbody>
              {activityLoading ? <tr><td colSpan={7}><div className="admin-table-skeleton">{Array.from({ length: 3 }, (_, index) => <span className="skeleton" key={index} />)}</div></td></tr> : payments.length ? payments.map(payment => <tr key={payment.id}><td className="font-mono text-xs">{payment.paymentReferenceId || "—"}</td><td>{payment.orderNumber || payment.orderId}</td><td className="text-xs">{payment.userId}</td><td>₹{payment.amount}</td><td>{payment.paymentMethod}</td><td><span className={`badge ${payment.paymentStatus === "paid" ? "badge-green" : "badge-blue"}`}>{payment.paymentStatus}</span></td><td>{new Date(payment.createdAt).toLocaleString()}</td></tr>) : <tr><td colSpan={7} className="text-center py-8 text-gray-500">No payment records yet.</td></tr>}
            </tbody></table>
          </div>
        </div>
      )}

      {/* TAB 2: ADD NEW ITEM FORM */}
      {activeTab === "add" && (
        <div className="admin-card">
          <div className="admin-card-header">
            <h2>➕ Add New Inventory Item to MongoDB</h2>
            <p className="text-xs text-gray-500">
              Create a single item with image upload, custom pricing, and direct storage in the MongoDB cluster.
            </p>
          </div>

          <form onSubmit={handleAddItem} className="space-y-6">
            <div className="form-grid">
              {/* SKU */}
              <div className="form-group">
                <div className="flex justify-between items-center">
                  <label>SKU (Stock Keeping Unit) *</label>
                  <button
                    type="button"
                    className="text-xs text-emerald-700 hover:underline font-semibold"
                    onClick={() => generateSku(category)}
                  >
                    Auto Generate
                  </button>
                </div>
                <input
                  type="text"
                  required
                  placeholder="e.g. MED-011 or STA-011"
                  value={sku}
                  onChange={(e) => setSku(e.target.value.toUpperCase())}
                />
              </div>

              {/* Item Name */}
              <div className="form-group">
                <label>Item Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Crocin 650mg Advance or A4 Spiral Notebook"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              {/* Category */}
              <div className="form-group">
                <label>Category *</label>
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    if (e.target.value === "Medicine") setIcon("💊");
                    else if (e.target.value === "Stationery") setIcon("✏️");
                    else if (e.target.value === "First Aid") setIcon("🩹");
                  }}
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value="Custom">+ Custom Category...</option>
                </select>
                {category === "Custom" && (
                  <input
                    type="text"
                    placeholder="Enter custom category"
                    className="mt-2"
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                  />
                )}
              </div>

              {/* Description */}
              <div className="form-group">
                <label>Description / Specification</label>
                <input
                  type="text"
                  placeholder="e.g. 15 tablets • GlaxoSmithKline or 200 pages • Unruled"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              {/* Price */}
              <div className="form-group">
                <label>Selling Price (₹) *</label>
                <input
                  type="number"
                  required
                  min="0"
                  step="0.5"
                  placeholder="e.g. 45"
                  value={price}
                  onChange={(e) => setPrice(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>

              {/* MRP */}
              <div className="form-group">
                <label>MRP (₹)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="e.g. 50"
                  value={mrp}
                  onChange={(e) => setMrp(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>

              {/* Stock */}
              <div className="form-group">
                <label>Initial Stock Quantity</label>
                <input
                  type="number"
                  min="0"
                  placeholder="e.g. 50"
                  value={stock}
                  onChange={(e) => setStock(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>

              {/* Unit */}
              <div className="form-group">
                <label>Packaging Unit</label>
                <input
                  type="text"
                  placeholder="e.g. strip, pack, piece, bottle, box"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </div>
            </div>

            {/* Icon / Emoji Selection */}
            <div className="form-group">
              <label>Icon / Emoji</label>
              <div className="flex flex-wrap gap-2 items-center mt-1">
                {EMOJI_OPTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className={`w-10 h-10 rounded-lg text-lg border flex items-center justify-center transition-all ${
                      icon === e
                        ? "border-emerald-600 bg-emerald-100 scale-110 shadow-sm"
                        : "border-gray-200 bg-white hover:bg-gray-50"
                    }`}
                    onClick={() => setIcon(e)}
                  >
                    {e}
                  </button>
                ))}
                <input
                  type="text"
                  placeholder="Custom"
                  className="w-20 text-center text-base"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                />
              </div>
            </div>

            {/* Image Upload Zone */}
            <div className="form-group">
              <label>Product Image Upload</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                <div className="image-upload-zone">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageFileChange}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                  <div className="text-3xl mb-1">🖼️</div>
                  <div className="text-sm font-bold text-gray-800">Click or Drag & Drop Image</div>
                  <div className="text-xs text-gray-500">Supports PNG, JPEG, SVG, WebP</div>
                </div>

                {imageUrl ? (
                  <div className="image-preview-box">
                    <img src={imageUrl} alt="Uploaded preview" className="image-preview-thumb" />
                    <div className="flex-1">
                      <div className="text-xs font-bold text-emerald-800">Image Loaded</div>
                      <button
                        type="button"
                        className="text-xs text-red-600 hover:underline mt-1 block"
                        onClick={() => setImageUrl("")}
                      >
                        Remove Image
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="text-xs text-gray-500">Or paste an Image URL:</label>
                    <input
                      type="url"
                      placeholder="https://example.com/product.jpg"
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Active Checkbox */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="item-active"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="w-4 h-4 text-emerald-600 rounded"
              />
              <label htmlFor="item-active" className="text-sm font-semibold cursor-pointer">
                Publish item immediately (Active in catalog)
              </label>
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button type="submit" className="btn-primary" disabled={savingItem}>
                {savingItem ? "Saving to MongoDB Cluster..." : "💾 Save Item to MongoDB ('inventory' collection)"}
              </button>
            </div>
          </form>
        </div>
      )}

      {editCandidate && <InventoryEditModal item={editCandidate} userId={userId} onClose={() => setEditCandidate(null)} onSaved={async () => { await fetchInventory(); onInventoryUpdated?.(); toast.success("Inventory item updated."); }} />}

      {/* TAB 3: BULK EXCEL UPLOAD */}
      {activeTab === "excel" && (
        <div className="admin-card">
          <div className="admin-card-header">
            <div>
              <h2>📤 Bulk Upload Inventory from Excel Sheet</h2>
              <p className="text-xs text-gray-500 mt-1">
                Upload a spreadsheet (.xlsx, .xls, or .csv) to batch insert/update items in the MongoDB database collection.
              </p>
            </div>
            <a
              href="/api/inventory/template"
              download="aaroda_inventory_template.xlsx"
              className="btn-secondary text-xs"
            >
              📥 Download Sample Excel Template
            </a>
          </div>

          {/* Drag & Drop Zone */}
          <div
            className={`excel-dropzone ${isDragging ? "active" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx, .xls, .csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) parseExcelFile(f);
              }}
            />
            <div className="dropzone-icon">📊</div>
            <h3>{excelFile ? excelFile.name : "Choose or drag & drop Excel Sheet"}</h3>
            <p>
              Supports columns: <b>SKU, Name, Category, Description, Price, MRP, Stock, Unit, Icon, Image</b>
            </p>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              Browse Excel Files (.xlsx, .xls, .csv)
            </button>
          </div>

          {/* Warnings */}
          {excelWarnings.length > 0 && (
            <div className="alert alert-info">
              <div>
                <b>Import notices:</b>
                <ul className="list-disc pl-5 mt-1 text-xs">
                  {excelWarnings.slice(0, 5).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Parsed Preview Table */}
          {parsedRows.length > 0 && (
            <div className="mt-6">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold text-gray-800 text-base">
                  Preview: {parsedRows.length} items parsed from Excel
                </h3>
                <button
                  className="btn-primary"
                  onClick={handleSyncExcelToMongo}
                  disabled={uploadingExcel}
                >
                  {uploadingExcel
                    ? "Adding to MongoDB Cluster..."
                    : "🚀 Add to MongoDB Cluster Collection ('inventory')"}
                </button>
              </div>

              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>SKU</th>
                      <th>Item Name</th>
                      <th>Category</th>
                      <th>Description</th>
                      <th>Price</th>
                      <th>MRP</th>
                      <th>Stock</th>
                      <th>Unit</th>
                      <th>Icon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((row, idx) => (
                      <tr key={idx}>
                        <td>{idx + 1}</td>
                        <td>
                          <span className="sku-tag">{row.sku}</span>
                        </td>
                        <td className="font-bold">{row.name}</td>
                        <td>
                          <span className="badge badge-blue">{row.category}</span>
                        </td>
                        <td className="text-xs text-gray-500 max-w-xs truncate">{row.description}</td>
                        <td className="font-bold text-emerald-800">₹{row.price}</td>
                        <td className="text-xs text-gray-400">₹{row.mrp}</td>
                        <td className="font-semibold">{row.stock}</td>
                        <td className="text-xs">{row.unit}</td>
                        <td className="text-lg">{row.icon}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  className="btn-primary"
                  onClick={handleSyncExcelToMongo}
                  disabled={uploadingExcel}
                >
                  {uploadingExcel
                    ? "Adding to MongoDB Cluster..."
                    : `🚀 Add ${parsedRows.length} Items to MongoDB Cluster`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: MONGODB POOLING & HEALTH */}
      {activeTab === "health" && (
        <div className="admin-card">
          <div className="admin-card-header">
            <h2>🩺 MongoDB Connection Pooling & Keep-Alive Health</h2>
            <button className="btn-secondary text-xs" onClick={fetchHealth} disabled={healthLoading}>
              {healthLoading ? "Pinging..." : "⚡ Ping DB Now"}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Connection Status
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`status-dot ${
                      health?.status === "healthy"
                        ? "healthy"
                        : health?.status === "unconfigured"
                        ? "prototype"
                        : "degraded"
                    }`}
                  />
                  <span className="text-lg font-bold text-gray-900 capitalize">
                    {health?.status === "healthy"
                      ? "Healthy & Connected"
                      : health?.status === "unconfigured"
                      ? "Local Prototype Mode (Ready for MONGODB_URI)"
                      : "Degraded / Connecting"}
                  </span>
                </div>
                <p className="text-xs text-gray-600 mt-2">
                  Database: <b>{health?.database || "nammacare"}</b> • Target Collection: <b>inventory</b>
                </p>
              </div>

              <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Connection Pooling Specs
                </div>
                <ul className="text-sm space-y-1.5 text-gray-700">
                  <li className="flex justify-between">
                    <span>Minimum Warm Connections:</span>
                    <b>minPoolSize: 5</b>
                  </li>
                  <li className="flex justify-between">
                    <span>Maximum Pool Size:</span>
                    <b>maxPoolSize: 20</b>
                  </li>
                  <li className="flex justify-between">
                    <span>Idle Connection Timeout:</span>
                    <b>maxIdleTimeMS: 60,000ms (60s)</b>
                  </li>
                  <li className="flex justify-between">
                    <span>Driver Topology Heartbeat:</span>
                    <b>heartbeatFrequencyMS: 10,000ms</b>
                  </li>
                  <li className="flex justify-between">
                    <span>Retry Strategy:</span>
                    <b>retryReads: true, retryWrites: true</b>
                  </li>
                </ul>
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Active Keep-Alive Ping Monitor
                </div>
                <ul className="text-sm space-y-2 text-gray-700">
                  <li className="flex justify-between">
                    <span>Active Background Ping:</span>
                    <span className="badge badge-green">Running (Every 15s)</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Ping Latency:</span>
                    <b>{health?.latencyMs !== undefined ? `${health.latencyMs} ms` : "—"}</b>
                  </li>
                  <li className="flex justify-between">
                    <span>Total Successful Pings:</span>
                    <b>{health?.stats?.success ?? 0}</b>
                  </li>
                  <li className="flex justify-between">
                    <span>Failed / Dropped Pings:</span>
                    <b>{health?.stats?.errors ?? 0}</b>
                  </li>
                  <li className="flex justify-between">
                    <span>Last Ping Check:</span>
                    <span className="text-xs font-mono">
                      {health?.lastPingAt ? new Date(health.lastPingAt).toLocaleTimeString() : "Just now"}
                    </span>
                  </li>
                </ul>
              </div>

              {health?.reason && (
                <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-800 text-xs">
                  <b>Connection notice:</b> {health.reason}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {deleteCandidate && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !deleting && setDeleteCandidate(null)}>
          <section className="confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description" onMouseDown={(event) => event.stopPropagation()}>
            <span className="confirmation-icon" aria-hidden="true">!</span>
            <h2 id="delete-dialog-title">Delete inventory item?</h2>
            <p id="delete-dialog-description"><strong>{deleteCandidate.name}</strong> ({deleteCandidate.sku}) will be permanently removed from your inventory. This action cannot be undone.</p>
            <div className="confirmation-actions">
              <button className="btn-secondary" onClick={() => setDeleteCandidate(null)} disabled={deleting}>Cancel</button>
              <button className="btn-danger" onClick={handleDeleteItem} disabled={deleting} autoFocus>{deleting ? "Deleting…" : "Delete item"}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
