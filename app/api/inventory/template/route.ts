import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const templateData = [
      {
        "Sr.": 1,
        "SKU": "STA-F11929-001",
        "Particulars": "S S Arrow Ball Pen",
        "Category": "Stationery",
        "Description": "Smooth blue ball pen • Office & Student",
        "HSN": "96081019",
        "GST%": 18,
        "Qty": 30,
        "Net Rate": 3.8,
        "Rate": 3.22,
        "MRP": 5.0,
        "Unit": "piece",
        "Icon": "🖊️",
        "Image URL": "",
        "Invoice No": "F11929",
        "Supplier": "RAJGURU PEN MART",
        "Active": "true",
      },
      {
        "Sr.": 2,
        "SKU": "STA-F11929-002",
        "Particulars": "Doms Brush Pen 14 Shades ₹200",
        "Category": "Stationery",
        "Description": "14 vibrant shades with refillable brush tip",
        "HSN": "96082000",
        "GST%": 18,
        "Qty": 15,
        "Net Rate": 135.0,
        "Rate": 114.41,
        "MRP": 200.0,
        "Unit": "pack",
        "Icon": "🎨",
        "Image URL": "",
        "Invoice No": "F11929",
        "Supplier": "RAJGURU PEN MART",
        "Active": "true",
      },
      {
        "Sr.": 3,
        "SKU": "MED-001",
        "Particulars": "Paracetamol 500mg (Dolo)",
        "Category": "Medicine",
        "Description": "10 tablets • Fever and mild pain relief",
        "HSN": "30049060",
        "GST%": 12,
        "Qty": 60,
        "Net Rate": 32.0,
        "Rate": 28.57,
        "MRP": 35.0,
        "Unit": "strip",
        "Icon": "💊",
        "Image URL": "",
        "Invoice No": "INV-2026-01",
        "Supplier": "Apollo Pharma",
        "Active": "true",
      },
      {
        "Sr.": 4,
        "SKU": "MED-002",
        "Particulars": "Vicks VapoRub 25ml",
        "Category": "Medicine",
        "Description": "Ayurvedic balm for cold & cough",
        "HSN": "30049011",
        "GST%": 12,
        "Qty": 40,
        "Net Rate": 60.0,
        "Rate": 53.57,
        "MRP": 65.0,
        "Unit": "bottle",
        "Icon": "🧴",
        "Image URL": "",
        "Invoice No": "INV-2026-01",
        "Supplier": "Apollo Pharma",
        "Active": "true",
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);

    // Set column widths for better user experience
    worksheet["!cols"] = [
      { wch: 6 },  // Sr.
      { wch: 18 }, // SKU
      { wch: 32 }, // Particulars
      { wch: 16 }, // Category
      { wch: 40 }, // Description
      { wch: 12 }, // HSN
      { wch: 8 },  // GST%
      { wch: 8 },  // Qty
      { wch: 12 }, // Net Rate
      { wch: 12 }, // Rate (Base)
      { wch: 10 }, // MRP
      { wch: 10 }, // Unit
      { wch: 8 },  // Icon
      { wch: 25 }, // Image URL
      { wch: 14 }, // Invoice No
      { wch: 22 }, // Supplier
      { wch: 8 },  // Active
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory_Template");

    const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="nammacare_inventory_template.xlsx"',
      },
    });
  } catch (error) {
    console.error("GET /api/inventory/template error:", error);
    return Response.json({ error: "Failed to generate template" }, { status: 500 });
  }
}
