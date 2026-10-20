"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { firebaseAuth } from "@/lib/firebase";

export type EditableInventory = {
  id?: string;
  _id?: string;
  sku: string;
  name: string;
  category: string;
  categoryType?: string;
  description: string;
  price: number;
  mrp: number;
  stock: number;
  unit: string;
  icon: string;
  active: boolean;
  imageUrl?: string | string[];
  imageUrls?: string[];
  imageMetadata?: Array<Record<string, unknown>>;
  hsn?: string;
  gstPercent?: number;
  netRate?: number;
  baseRate?: number;
  invoiceNo?: string;
  version?: number;
};

export default function InventoryEditModal({
  item,
  onClose,
  onSaved,
}: {
  item: EditableInventory;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [form, setForm] = useState(item);
  const [images, setImages] = useState<string[]>(
    item.imageUrls?.length
      ? item.imageUrls
      : item.imageUrl
        ? Array.isArray(item.imageUrl) ? item.imageUrl : [item.imageUrl]
        : [],
  );
  const [metadata, setMetadata] = useState<Array<Record<string, unknown>>>(
    item.imageMetadata || [],
  );
  const [uploading, setUploading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const productId = item.id || item._id || item.sku;
  const imageLabel = useMemo(
    () => `${images.length} image${images.length === 1 ? "" : "s"}`,
    [images.length],
  );
  const update = (
    key: keyof EditableInventory,
    value: string | number | boolean,
  ) => setForm((current) => ({ ...current, [key]: value }));
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const idToken = await firebaseAuth?.currentUser?.getIdToken();
    if (!idToken) {
      setError("Sign in before uploading product images.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const uploaded = await Promise.all(
        files.map(async (file) => {
          const body = new FormData();
          body.append("file", file);
          body.append("productId", productId);
          const response = await fetch("/api/inventory/upload", { method: "POST", headers: { Authorization: `Bearer ${idToken}` }, body });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || `${file.name} could not be uploaded`);
          return { url: data.url as string, ...data.metadata };
        }),
      );
      setImages((current) => [...current, ...uploaded.map((file) => file.url)]);
      setMetadata((current) => [...current, ...uploaded]);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Image upload failed",
      );
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const idToken = await firebaseAuth?.currentUser?.getIdToken();
      if (!idToken) throw new Error("Your administrator session has expired. Please sign in again.");
      const response = await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          ...form,
          id: productId,
          imageUrls: images,
          imageMetadata: metadata,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update item");
      await onSaved();
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to update item",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="inventory-edit-overlay" onMouseDown={onClose}>
      <section
        className="inventory-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${item.name}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">EDIT INVENTORY</p>
            <h2>{item.name}</h2>
          </div>
          <button onClick={onClose} aria-label="Close editor">
            ×
          </button>
        </header>
        <form onSubmit={save}>
          <div className="edit-form-grid">
            <Field
              label="SKU"
              value={form.sku}
              onChange={(value) => update("sku", value)}
              required
            />
            <Field
              label="Item name"
              value={form.name}
              onChange={(value) => update("name", value)}
              required
            />
            <Field
              label="Category"
              value={form.category}
              onChange={(value) => update("category", value)}
            />
            <label className="edit-field"><span>Category type</span><select value={form.categoryType || "Stationery"} onChange={(event) => update("categoryType", event.target.value)}>{["Stationery", "Personal Care", "Kids", "Electronics", "Beauty", "Decor"].map((type) => <option key={type}>{type}</option>)}</select></label>
            <Field
              label="Unit"
              value={form.unit}
              onChange={(value) => update("unit", value)}
            />
            <Field
              label="Price"
              type="number"
              value={form.price}
              onChange={(value) => update("price", Number(value))}
            />
            <Field
              label="MRP"
              type="number"
              value={form.mrp}
              onChange={(value) => update("mrp", Number(value))}
            />
            <Field
              label="Stock"
              type="number"
              value={form.stock}
              onChange={(value) => update("stock", Number(value))}
            />
            <Field
              label="Icon"
              value={form.icon}
              onChange={(value) => update("icon", value)}
            />
            <Field
              label="HSN"
              value={form.hsn || ""}
              onChange={(value) => update("hsn", value)}
            />
            <Field
              label="GST %"
              type="number"
              value={form.gstPercent || ""}
              onChange={(value) => update("gstPercent", Number(value))}
            />
            <Field
              label="Invoice no."
              value={form.invoiceNo || ""}
              onChange={(value) => update("invoiceNo", value)}
            />
          </div>
          <label className="edit-textarea">
            <span>Description</span>
            <textarea
              value={form.description}
              onChange={(event) => update("description", event.target.value)}
            />
          </label>
          <label className="edit-checkbox">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => update("active", event.target.checked)}
            />{" "}
            Product is active in the catalogue
          </label>
          <div className="edit-images">
            <div>
              <b>Product images</b>
              <small>
                {imageLabel} · Stored in Vercel Blob under product ID{" "}
                {productId}
              </small>
            </div>
            <label className="image-upload-button">
              {uploading ? "Uploading…" : "Upload images"}
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={upload}
                disabled={uploading}
              />
            </label>
            <div className="edit-image-grid">
              {images.map((url, index) => (
                <figure key={url}>
                  <img src={url} alt="" />
                  <button
                    type="button"
                    onClick={() => {
                      setImages((current) =>
                        current.filter((_, i) => i !== index),
                      );
                      setMetadata((current) =>
                        current.filter((_, i) => i !== index),
                      );
                    }}
                    aria-label="Remove image"
                  >
                    ×
                  </button>
                </figure>
              ))}
            </div>
          </div>
          {error && <p className="edit-error">{error}</p>}
          <footer>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" disabled={saving || uploading}>
              {saving ? "Saving…" : "Save all changes"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="edit-field">
      <span>{label}</span>
      <input
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
