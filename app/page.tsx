"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import AdminDashboard, { AdminProduct } from "@/components/AdminDashboard";

type Product = {
  id: string;
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
};

type RazorpayResult = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open(): void };
  }
}

export default function Home() {
  const [viewMode, setViewMode] = useState<"store" | "admin">("store");
  const [started, setStarted] = useState(false);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [knownProducts, setKnownProducts] = useState<Record<string, Product>>({});
  const [cart, setCart] = useState<Record<string, number>>({});
  const [paying, setPaying] = useState(false);
  const [confirmed, setConfirmed] = useState("");
  const [mongoStatus, setMongoStatus] = useState<string>("healthy");
  const [mongoLatency, setMongoLatency] = useState<number | null>(null);

  // Ping MongoDB health periodically
  const checkMongoHealth = async () => {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      if (data.mongo) {
        setMongoStatus(data.mongo.status);
        setMongoLatency(data.mongo.latencyMs ?? null);
      }
    } catch {
      setMongoStatus("unavailable");
    }
  };

  useEffect(() => {
    checkMongoHealth();
    const interval = setInterval(checkMongoHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  const loadProducts = () => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/inventory?category=${encodeURIComponent(category)}&search=${encodeURIComponent(search)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setProducts(data.items);
        setKnownProducts((old) => ({
          ...old,
          ...Object.fromEntries((data.items as Product[]).map((item) => [item.id, item])),
        }));
        setError("");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => setLoading(false));
    return controller;
  };

  useEffect(() => {
    if (!started) return;
    const controller = loadProducts();
    return () => controller.abort();
  }, [started, category, search]);

  useEffect(() => {
    if (document.getElementById("razorpay-checkout")) return;
    const script = document.createElement("script");
    script.id = "razorpay-checkout";
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
  }, []);

  const units = Object.values(cart).reduce((a, b) => a + b, 0);
  const subtotal = Object.entries(cart).reduce(
    (sum, [id, quantity]) => sum + (knownProducts[id]?.price || 0) * quantity,
    0
  );
  const visible = useMemo(() => products, [products]);

  function qty(id: string, delta: number) {
    setCart((old) => ({ ...old, [id]: Math.max(0, (old[id] || 0) + delta) }));
  }

  function sendHi(e?: FormEvent) {
    e?.preventDefault();
    setStarted(true);
    setCategory("All");
  }

  async function checkout() {
    setPaying(true);
    setError("");
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: Object.entries(cart)
            .filter(([, q]) => q > 0)
            .map(([id, quantity]) => ({ id, quantity })),
        }),
      });
      const order = await response.json();
      if (!response.ok) throw new Error(order.error);
      if (!window.Razorpay) throw new Error("Payment window is still loading. Please try again.");
      new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "Aaroda Books and Stationery",
        description: `Order ${order.orderNumber}`,
        order_id: order.razorpayOrderId,
        theme: { color: "#126b53" },
        handler: async (result: RazorpayResult) => {
          const verified = await fetch("/api/orders/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...result, mongoOrderId: order.mongoOrderId }),
          });
          if (!verified.ok) throw new Error("Payment could not be verified");
          setConfirmed(order.orderNumber);
          setCart({});
        },
      }).open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to place order");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Global Navigation Bar */}
      <nav className="top-nav">
        <div className="nav-brand">
          <span>Aaroda</span> Books & Stationery
          <small className="text-xs text-emerald-200 font-normal ml-2 hidden sm:inline">
            Books, Stationery & Study Essentials
          </small>
        </div>

        <div className="nav-actions">
          {/* Mode Switcher */}
          <div className="mode-switcher">
            <button
              className={`mode-btn ${viewMode === "store" ? "active" : ""}`}
              onClick={() => setViewMode("store")}
            >
              🛍️ Store Chat
            </button>
            <button
              className={`mode-btn ${viewMode === "admin" ? "active" : ""}`}
              onClick={() => setViewMode("admin")}
            >
              ⚙️ Admin & Inventory
            </button>
          </div>

          {/* MongoDB Cluster Health Pill */}
          <div className="mongo-status-pill hidden md:flex">
            <span
              className={`status-dot ${
                mongoStatus === "healthy"
                  ? "healthy"
                  : mongoStatus === "unconfigured" || mongoStatus === "local_prototype"
                  ? "prototype"
                  : "degraded"
              }`}
            />
            <span>
              Mongo:{" "}
              {mongoStatus === "healthy"
                ? "Cluster Active"
                : mongoStatus === "unconfigured" || mongoStatus === "local_prototype"
                ? "Local Mode"
                : "Degraded"}
            </span>
            {mongoLatency !== null && <span className="opacity-75">({mongoLatency}ms)</span>}
          </div>
        </div>
      </nav>

      {/* View Mode Switching */}
      {viewMode === "admin" ? (
        <AdminDashboard
          onSwitchToStore={() => setViewMode("store")}
          onInventoryUpdated={() => {
            if (started) loadProducts();
          }}
        />
      ) : confirmed ? (
        <main className="success">
          <section>
            <div>✓</div>
            <p>ORDER CONFIRMED</p>
            <h1>Thank you!</h1>
            <span>{confirmed}</span>
            <p>Aaroda Books and Stationery has received your order.</p>
            <button
              onClick={() => {
                setConfirmed("");
                setStarted(false);
              }}
            >
              Start another order
            </button>
          </section>
        </main>
      ) : (
        <main className="shell">
          <section className="intro">
            <div className="brand">
              Aaroda <span>Books & Stationery</span>
            </div>
            <p className="eyebrow">YOUR TRUSTED BOOKS & STATIONERY STORE</p>
            <h1>
              Everyday essentials,
              <br />
              <em>one message away.</em>
            </h1>
            <p className="lede">
              Order books, stationery, and study essentials through a simple, friendly chat. Real-time MongoDB inventory sync & secure checkout.
            </p>
            <div className="features">
              <span>⚡ Fast Delivery</span>
              <span>● Live MongoDB inventory</span>
              <span>📚 Books & Stationery</span>
            </div>
            <div className="mt-8 pt-4 border-t border-emerald-900/10">
              <button
                className="btn-secondary text-xs"
                onClick={() => setViewMode("admin")}
              >
                ⚙️ Open Admin & Bulk Excel Upload →
              </button>
            </div>
          </section>

          <section className="phone" aria-label="Aaroda Books and Stationery ordering assistant">
            <header>
              <div className="avatar">A</div>
              <div>
                <b>Aaroda Books & Stationery</b>
                <small>
                  <i /> online
                </small>
              </div>
              <button
                type="button"
                className="text-white opacity-80 hover:opacity-100 text-xs font-bold ml-auto px-2 py-1 rounded bg-black/20"
                onClick={() => setViewMode("admin")}
                title="Open Admin"
              >
                Admin ⚙
              </button>
            </header>

            <div className="chat">
              <div className="today">TODAY</div>
              {!started ? (
                <div className="welcome">
                  <div className="bubble bot">
                    Namaskara! 👋 Welcome to <b>Aaroda Books and Stationery</b>.<br />
                    Send <b>Hi</b> to start your order.
                    <time>10:24 AM</time>
                  </div>
                  <button onClick={() => sendHi()}>Hi 👋</button>
                </div>
              ) : (
                <>
                  <div className="bubble user">
                    Hi <time>10:24 AM ✓✓</time>
                  </div>
                  <div className="bubble bot">
                    Namaskara! 👋 What would you like to order today?
                    <time>10:24 AM</time>
                  </div>

                  <div className="categories">
                    {["All", "Medicine", "Stationery", "Personal Care", "First Aid"].map((c) => (
                      <button
                        key={c}
                        className={category === c ? "active" : ""}
                        onClick={() => setCategory(c)}
                      >
                        {c === "Medicine"
                          ? "💊 "
                          : c === "Stationery"
                          ? "✏️ "
                          : c === "Personal Care"
                          ? "🧴 "
                          : c === "First Aid"
                          ? "🩹 "
                          : "⌂ "}
                        {c}
                      </button>
                    ))}
                  </div>

                  <section className="catalog">
                    <label>
                      ⌕
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search inventory..."
                      />
                    </label>
                    <p>{loading ? "CHECKING STOCK..." : `${visible.length} ITEMS IN STOCK`}</p>
                    <div className="items">
                      {visible.map((item) => (
                        <article key={item.id}>
                          <div className="icon">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt={item.name}
                                className="w-full h-full object-cover rounded-lg"
                              />
                            ) : (
                              item.icon || "📦"
                            )}
                          </div>
                          <div className="info">
                            <b>{item.name}</b>
                            <small>{item.description}</small>
                            <strong>
                              ₹{item.price} <s>₹{item.mrp}</s>
                            </strong>
                          </div>
                          {!cart[item.id] ? (
                            <button className="add" onClick={() => qty(item.id, 1)}>
                              ADD
                            </button>
                          ) : (
                            <div className="qty">
                              <button onClick={() => qty(item.id, -1)}>−</button>
                              <b>{cart[item.id]}</b>
                              <button onClick={() => qty(item.id, 1)}>+</button>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </div>

            {error && <div className="error">{error}</div>}

            {units > 0 && (
              <button className="cartbar" onClick={checkout} disabled={paying}>
                <span>
                  <b>
                    {units} item{units !== 1 ? "s" : ""}
                  </b>
                  <small>₹{subtotal} + ₹20 delivery</small>
                </span>
                <strong>{paying ? "Preparing…" : "Pay & place order →"}</strong>
              </button>
            )}

            <form className="composer" onSubmit={sendHi}>
              <button type="button">☺</button>
              <input placeholder="Type a message" />
              <button className="send">➤</button>
            </form>
          </section>
        </main>
      )}
    </div>
  );
}
