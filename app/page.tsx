"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import AdminDashboard from "@/components/AdminDashboard";
import AuthModal from "@/components/AuthModal";
import { firebaseAuth } from "@/lib/firebase";
import { onIdTokenChanged, signOut, User } from "firebase/auth";
import { isAdminEmail } from "@/lib/admin";

type Product = { id: string; sku: string; name: string; category: string; description: string; price: number; mrp: number; stock: number; unit: string; icon: string; imageUrl?: string };
type RazorpayResult = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
declare global { interface Window { Razorpay: new (options: Record<string, unknown>) => { open(): void } } }

const categories = ["All", "Stationery", "Medicine", "Personal Care", "First Aid"];
const categoryIcons: Record<string, string> = { All: "⌂", Stationery: "✏️", Medicine: "💊", "Personal Care": "🧴", "First Aid": "🩹" };

function ProductSkeleton() { return <div className="store-grid" aria-label="Loading products" aria-busy="true">{Array.from({ length: 8 }, (_, index) => <article className="product-card product-skeleton" key={index}><span className="skeleton product-image-skeleton" /><div className="product-copy"><span className="skeleton skeleton-line skeleton-title" /><span className="skeleton skeleton-line skeleton-description" /><span className="skeleton skeleton-line skeleton-price" /></div><span className="skeleton skeleton-button" /></article>)}</div>; }

export default function Home() {
  const [viewMode, setViewMode] = useState<"store" | "admin">("store");
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [knownProducts, setKnownProducts] = useState<Record<string, Product>>({});
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [confirmed, setConfirmed] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => firebaseAuth ? onIdTokenChanged(firebaseAuth, value => { setUser(value); setAuthReady(true); }) : (setAuthReady(true), undefined), []);

  useEffect(() => { const timer = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300); return () => clearTimeout(timer); }, [searchInput]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    fetch(`/api/inventory?category=${encodeURIComponent(category)}&search=${encodeURIComponent(search)}&page=${page}&limit=12`, { signal: controller.signal })
      .then((response) => response.json()).then((data) => { if (data.error) throw new Error(data.error); setProducts(old => page === 1 ? (data.items || []) : [...old, ...(data.items || [])]); setTotal(data.total || 0); setTotalPages(data.totalPages || 1); setKnownProducts(old => ({ ...old, ...Object.fromEntries((data.items as Product[]).map(item => [item.id, item])) })); setError(""); })
      .catch((reason) => { if (reason.name !== "AbortError") setError(reason.message || "We could not load the catalogue."); }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [category, search, page]);
  useEffect(() => { const node=loadMoreRef.current; if(!node || loading || page>=totalPages) return; const observer=new IntersectionObserver(entries=>{if(entries[0]?.isIntersecting)setPage(current=>current<totalPages?current+1:current)},{rootMargin:"300px"}); observer.observe(node); return()=>observer.disconnect(); },[loading,page,totalPages]);
  useEffect(() => { if (document.getElementById("razorpay-checkout")) return; const script = document.createElement("script"); script.id = "razorpay-checkout"; script.src = "https://checkout.razorpay.com/v1/checkout.js"; script.async = true; document.body.appendChild(script); }, []);

  const units = Object.values(cart).reduce((a, b) => a + b, 0);
  const subtotal = Object.entries(cart).reduce((sum, [id, quantity]) => sum + (knownProducts[id]?.price || 0) * quantity, 0);
  const cartItems = useMemo(() => Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ({ product: knownProducts[id], quantity })).filter(({ product }) => product), [cart, knownProducts]);
  function qty(id: string, delta: number) { setCart(old => ({ ...old, [id]: Math.max(0, (old[id] || 0) + delta) })); }
  async function checkout() {
    setPaying(true); setError("");
    try {
      const response = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: Object.entries(cart).filter(([, q]) => q > 0).map(([id, quantity]) => ({ id, quantity })) }) });
      const order = await response.json(); if (!response.ok) throw new Error(order.error); if (!window.Razorpay) throw new Error("Payment is loading. Please try again.");
      new window.Razorpay({ key: order.keyId, amount: order.amount, currency: order.currency, name: "Aaroda Books and Stationery", description: `Order ${order.orderNumber}`, order_id: order.razorpayOrderId, theme: { color: "#126b53" }, handler: async (result: RazorpayResult) => { const verified = await fetch("/api/orders/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...result, mongoOrderId: order.mongoOrderId }) }); if (!verified.ok) throw new Error("Payment could not be verified"); setConfirmed(order.orderNumber); setCart({}); setCartOpen(false); } }).open();
    } catch (reason) { const message=reason instanceof Error ? reason.message : "Unable to place order"; setError(message); toast.error(message); } finally { setPaying(false); }
  }
  const chooseCategory = (next: string) => { setCategory(next); setPage(1); };

  if (viewMode === "admin") return <><StoreNav cartCount={units} user={user} onAuth={() => setAuthOpen(true)} onSignOut={() => firebaseAuth && signOut(firebaseAuth)} onStore={() => setViewMode("store")} onAdmin={() => {}} /><AdminDashboard userId={user?.uid} onSwitchToStore={() => setViewMode("store")} onInventoryUpdated={() => setPage(1)} />{authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}</>;
  if (confirmed) return <main className="success"><section><div>✓</div><p>ORDER CONFIRMED</p><h1>Thank you!</h1><span>{confirmed}</span><p>Aaroda Books and Stationery has received your order.</p><button onClick={() => setConfirmed("")}>Continue shopping</button></section></main>;
  return <div className="storefront"><StoreNav cartCount={units} user={user} onAuth={() => setAuthOpen(true)} onSignOut={() => firebaseAuth && signOut(firebaseAuth)} onStore={() => {}} onAdmin={() => setViewMode("admin")} />
    <main className="store-main">
      <section className="store-hero"><p className="eyebrow">Aaroda Books & Stationery</p>{!authReady?<><span className="skeleton welcome-skeleton"/><span className="skeleton welcome-skeleton short"/></>:user&&<h2 className="welcome-title">Welcome, {user.displayName?.split(" ")[0] || user.email?.split("@")[0]}</h2>}<h1>Your everyday essentials, <em>ready to order.</em></h1><p>Browse what is in stock, add it to your basket, and check out securely.</p><div className="hero-pills"><span>⚡ Fast delivery</span><span>● Live inventory</span><span>🔒 Secure payment</span></div></section>
      <section className="catalogue" aria-label="Product catalogue"><div className="catalogue-heading"><div><p className="eyebrow">SHOP THE CATALOGUE</p><h2>Find what you need</h2></div><span>{loading ? "Updating…" : `${total} items available`}</span></div>
        <label className="store-search"><span>⌕</span><input value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Search books, pens, essentials…" /><button type="button" aria-label="Clear search" hidden={!searchInput} onClick={() => setSearchInput("")}>×</button></label>
        <div className="store-categories" role="tablist">{categories.map(item => <button key={item} role="tab" aria-selected={category === item} className={category === item ? "active" : ""} onClick={() => chooseCategory(item)}><span>{categoryIcons[item]}</span>{item}</button>)}</div>
        {error && <div className="store-error" role="alert">{error}<button onClick={() => setPage(page)}>Try again</button></div>}
        {loading ? <ProductSkeleton /> : products.length ? <div className="store-grid">{products.map(item => <article className="product-card" key={item.id}><div className="product-image">{item.imageUrl ? <img src={item.imageUrl} alt={item.name} /> : <span>{item.icon || "📦"}</span>}</div><div className="product-copy"><p>{item.category}</p><h3>{item.name}</h3><small>{item.description || `${item.stock} ${item.unit} available`}</small><strong>₹{item.price} {item.mrp > item.price && <s>₹{item.mrp}</s>}</strong></div>{!cart[item.id] ? <button className="add-to-cart" onClick={() => qty(item.id, 1)}>Add <span>+</span></button> : <div className="product-quantity"><button aria-label={`Remove ${item.name}`} onClick={() => qty(item.id, -1)}>−</button><b>{cart[item.id]}</b><button aria-label={`Add another ${item.name}`} onClick={() => qty(item.id, 1)}>+</button></div>}</article>)}</div> : <div className="empty-catalogue"><span>🛍️</span><h3>No matches found</h3><p>Try another search or choose a different category.</p><button onClick={() => { setSearchInput(""); chooseCategory("All"); }}>Browse all items</button></div>}
        {page < totalPages && <div ref={loadMoreRef} className="infinite-loader">{loading ? "Loading more items…" : "Scroll for more items"}</div>}
      </section>
    </main>
    {units > 0 && <button className="basket-bar" onClick={() => setCartOpen(true)}><span className="basket-count">{units}</span><span><b>View basket</b><small>{units} item{units !== 1 ? "s" : ""} · ₹{subtotal}</small></span><strong>Checkout →</strong></button>}
    {cartOpen && <div className="cart-overlay" role="presentation" onMouseDown={() => setCartOpen(false)}><aside className="cart-drawer" role="dialog" aria-modal="true" aria-label="Your basket" onMouseDown={event => event.stopPropagation()}><header><div><p className="eyebrow">YOUR BASKET</p><h2>Ready when you are</h2></div><button aria-label="Close basket" onClick={() => setCartOpen(false)}>×</button></header><div className="cart-items">{cartItems.map(({ product, quantity }) => product && <article key={product.id}><div className="cart-icon">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : product.icon}</div><div><b>{product.name}</b><small>₹{product.price} each</small><div className="cart-quantity"><button onClick={() => qty(product.id, -1)}>−</button><span>{quantity}</span><button onClick={() => qty(product.id, 1)}>+</button></div></div><strong>₹{product.price * quantity}</strong></article>)}</div><footer><div><span>Items total</span><b>₹{subtotal}</b></div><div><span>Delivery</span><b>₹20</b></div><div className="cart-total"><span>Total</span><b>₹{subtotal + 20}</b></div><button className="checkout-button" onClick={checkout} disabled={paying}>{paying ? "Preparing secure payment…" : "Pay & place order →"}</button></footer></aside></div>}
  {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}</div>;
}

function StoreNav({ cartCount, user, onAuth, onSignOut, onStore, onAdmin }: { cartCount: number; user: User | null; onAuth: () => void; onSignOut: () => void; onStore: () => void; onAdmin: () => void }) { const [open,setOpen]=useState(false); return <nav className="store-nav"><button className="store-logo" onClick={onStore}><span>A</span><div><b>Aaroda</b><small>Books & Stationery</small></div></button><div className="store-nav-actions">{user ? <div className="profile-wrap"><button className="nav-user" onClick={()=>setOpen(!open)}>{user.photoURL ? <img src={user.photoURL} alt="" /> : "👤"}<span>{user.displayName?.split(" ")[0] || user.email?.split("@")[0]}</span></button>{open&&<div className="profile-menu"><button onClick={()=>location.assign("/orders")}>📦 Orders</button><button onClick={onSignOut}>↪ Logout</button></div>}</div> : <button className="nav-admin" onClick={onAuth}>Sign in</button>}{isAdminEmail(user?.email) && <button className="nav-admin" onClick={onAdmin}>Admin</button>}<button className="nav-basket" onClick={onStore} aria-label="Shopping basket">🛒{cartCount > 0 && <i>{cartCount}</i>}</button></div></nav>; }
