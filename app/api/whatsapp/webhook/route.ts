import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

type Category = "medicine" | "stationery";
type InventoryItem = { id: number; name: string; detail: string; price: number; category: Category };
type Session = { stage: string; category: Category | null; searchResults: number[]; cart: Record<string, number> };

const inventory: InventoryItem[] = [
  { id: 1, name: "Paracetamol 500mg", detail: "10 tablets • Dolo", price: 32, category: "medicine" },
  { id: 2, name: "Cetirizine 10mg", detail: "10 tablets • Generic", price: 24, category: "medicine" },
  { id: 3, name: "Digene Mint", detail: "15 tablets • Abbott", price: 29, category: "medicine" },
  { id: 4, name: "Band-Aid Washproof", detail: "10 strips • J&J", price: 45, category: "medicine" },
  { id: 5, name: "Vitamin C 500mg", detail: "15 tablets • Limcee", price: 38, category: "medicine" },
  { id: 6, name: "Classmate Notebook", detail: "172 pages • Ruled", price: 65, category: "stationery" },
  { id: 7, name: "Blue Ball Pens", detail: "Pack of 5 • Reynolds", price: 50, category: "stationery" },
  { id: 8, name: "Apsara Pencils", detail: "Pack of 10 • Extra dark", price: 55, category: "stationery" },
  { id: 9, name: "Sticky Notes", detail: "100 sheets • Yellow", price: 42, category: "stationery" },
  { id: 10, name: "Geometry Box", detail: "8-piece student set", price: 110, category: "stationery" },
];

function runtime() {
  return env as unknown as Record<string, string | D1Database>;
}

async function initDb(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    phone TEXT PRIMARY KEY,
    stage TEXT NOT NULL DEFAULT 'start',
    category TEXT,
    search_results TEXT NOT NULL DEFAULT '[]',
    cart TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
  )`).run();
}

async function getSession(phone: string): Promise<Session> {
  const db = runtime().DB as D1Database;
  await initDb(db);
  const row = await db.prepare("SELECT stage, category, search_results, cart FROM whatsapp_sessions WHERE phone = ?").bind(phone).first<Record<string, string>>();
  if (!row) return { stage: "start", category: null, searchResults: [], cart: {} };
  return { stage: row.stage, category: (row.category as Category) || null, searchResults: JSON.parse(row.search_results), cart: JSON.parse(row.cart) };
}

async function saveSession(phone: string, session: Session) {
  const db = runtime().DB as D1Database;
  await db.prepare(`INSERT INTO whatsapp_sessions (phone, stage, category, search_results, cart, updated_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(phone) DO UPDATE SET stage=excluded.stage, category=excluded.category,
    search_results=excluded.search_results, cart=excluded.cart, updated_at=excluded.updated_at`)
    .bind(phone, session.stage, session.category, JSON.stringify(session.searchResults), JSON.stringify(session.cart), Date.now()).run();
}

async function send(to: string, body: Record<string, unknown>) {
  const cfg = runtime();
  const token = cfg.WHATSAPP_ACCESS_TOKEN as string;
  const numberId = cfg.WHATSAPP_PHONE_NUMBER_ID as string;
  const version = (cfg.WHATSAPP_API_VERSION as string) || "v23.0";
  if (!token || !numberId) throw new Error("WhatsApp credentials are not configured");
  const response = await fetch(`https://graph.facebook.com/${version}/${numberId}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...body }),
  });
  if (!response.ok) throw new Error(`WhatsApp API ${response.status}: ${await response.text()}`);
}

const sendText = (to: string, text: string) => send(to, { type: "text", text: { preview_url: true, body: text } });

async function sendWelcome(to: string) {
  await send(to, { type: "interactive", interactive: { type: "button", body: { text: "Namaskara! 👋 Welcome to NammaCare. What would you like to order today?" }, footer: { text: "Bengaluru • Prototype store" }, action: { buttons: [
    { type: "reply", reply: { id: "category_medicine", title: "💊 Medicine" } },
    { type: "reply", reply: { id: "category_stationery", title: "✏️ Stationery" } },
  ] } } });
}

async function sendInventory(to: string, category: Category, items: InventoryItem[]) {
  if (!items.length) return sendText(to, "I couldn't find that item. Try another search, or type ALL to see everything in this category.");
  await send(to, { type: "interactive", interactive: { type: "list", header: { type: "text", text: category === "medicine" ? "Medicine" : "Stationery" }, body: { text: "Choose an item below, or type a product name to search." }, footer: { text: "Tap an item to add 1 • reply ADD <no> <qty> for more" }, action: { button: "View items", sections: [{ title: `${items.length} items in stock`, rows: items.slice(0, 10).map((item) => ({ id: `item_${item.id}`, title: `${item.name} • ₹${item.price}`.slice(0, 24), description: item.detail.slice(0, 72) })) }] } } });
}

function cartSummary(session: Session) {
  const lines = Object.entries(session.cart).filter(([, qty]) => qty > 0).map(([id, qty]) => {
    const item = inventory.find((entry) => entry.id === Number(id))!;
    return `${item.name} × ${qty} — ₹${item.price * qty}`;
  });
  const subtotal = Object.entries(session.cart).reduce((sum, [id, qty]) => sum + (inventory.find((item) => item.id === Number(id))?.price || 0) * qty, 0);
  return { text: `🛒 *Your order*\n${lines.join("\n")}\n\nSubtotal: ₹${subtotal}\nDelivery: ₹20\n*Total: ₹${subtotal + 20}*`, total: subtotal + 20 };
}

async function sendCart(to: string, session: Session) {
  const summary = cartSummary(session);
  await send(to, { type: "interactive", interactive: { type: "button", body: { text: summary.text }, action: { buttons: [
    { type: "reply", reply: { id: "checkout", title: "Pay & place order" } },
    { type: "reply", reply: { id: "search_more", title: "Add more items" } },
  ] } } });
}

async function createPaymentLink(phone: string, amount: number) {
  const cfg = runtime();
  const key = cfg.RAZORPAY_KEY_ID as string, secret = cfg.RAZORPAY_KEY_SECRET as string;
  if (!key || !secret) throw new Error("Razorpay test keys are not configured");
  const auth = btoa(`${key}:${secret}`);
  const response = await fetch("https://api.razorpay.com/v1/payment_links", { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" }, body: JSON.stringify({
    amount: amount * 100, currency: "INR", accept_partial: false, reference_id: `NC${Date.now()}`,
    description: "NammaCare test order", customer: { contact: `+${phone}` }, notify: { sms: false, email: false }, reminder_enable: false,
  }) });
  if (!response.ok) throw new Error(`Razorpay API ${response.status}: ${await response.text()}`);
  return (await response.json() as { short_url: string }).short_url;
}

function getIncoming(payload: any) {
  const value = payload?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  if (!message) return null;
  const id = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || null;
  return { from: message.from as string, text: (message.text?.body || "").trim(), id };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode"), token = url.searchParams.get("hub.verify_token"), challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === runtime().WHATSAPP_VERIFY_TOKEN) return new Response(challenge || "", { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const incoming = getIncoming(await request.json());
  if (!incoming) return Response.json({ received: true });
  try {
    const session = await getSession(incoming.from);
    const lower = incoming.text.toLowerCase();
    if (["hi", "hello", "hey", "start", "menu"].includes(lower)) {
      Object.assign(session, { stage: "category", category: null, searchResults: [] }); await saveSession(incoming.from, session); await sendWelcome(incoming.from);
    } else if (incoming.id?.startsWith("category_")) {
      session.category = incoming.id.replace("category_", "") as Category; session.stage = "browse";
      const items = inventory.filter((item) => item.category === session.category); session.searchResults = items.map((item) => item.id); await saveSession(incoming.from, session); await sendInventory(incoming.from, session.category, items);
    } else if (incoming.id?.startsWith("item_")) {
      const id = Number(incoming.id.replace("item_", "")); session.cart[id] = (session.cart[id] || 0) + 1; await saveSession(incoming.from, session); await sendCart(incoming.from, session);
    } else if (incoming.id === "search_more") {
      await sendText(incoming.from, "Type a product name to search, or type ALL to view the category.");
    } else if (incoming.id === "checkout") {
      const summary = cartSummary(session); const link = await createPaymentLink(incoming.from, summary.total);
      await sendText(incoming.from, `Your test order is ready ✅\n\nPay securely here:\n${link}\n\nThis is a Razorpay Test Mode payment link; no real money will be charged.`); session.stage = "payment"; await saveSession(incoming.from, session);
    } else if (lower.startsWith("add ")) {
      const [, rawIndex, rawQty = "1"] = lower.split(/\s+/); const itemId = session.searchResults[Number(rawIndex) - 1] || Number(rawIndex); const item = inventory.find((entry) => entry.id === itemId); const qty = Math.min(10, Math.max(1, Number(rawQty) || 1));
      if (!item) await sendText(incoming.from, "I couldn't identify that item. Example: ADD 1 2"); else { session.cart[item.id] = (session.cart[item.id] || 0) + qty; await saveSession(incoming.from, session); await sendCart(incoming.from, session); }
    } else if (session.category) {
      const items = inventory.filter((item) => item.category === session.category && (lower === "all" || `${item.name} ${item.detail}`.toLowerCase().includes(lower)));
      session.searchResults = items.map((item) => item.id); await saveSession(incoming.from, session); await sendInventory(incoming.from, session.category, items);
    } else await sendWelcome(incoming.from);
  } catch (error) { console.error(error); }
  return Response.json({ received: true });
}
