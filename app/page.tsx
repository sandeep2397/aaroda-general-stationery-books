"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import AdminDashboard from "@/components/AdminDashboard";
import AuthModal from "@/components/AuthModal";
import { firebaseAuth } from "@/lib/firebase";
import { onIdTokenChanged, signOut, User } from "firebase/auth";
import { isAdminEmail } from "@/lib/admin";

type Product = {
  id: string;
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
  imageUrl?: string;
  imageUrls?: string[];
};
type DeliveryAddress = { id: string; label: string; recipientName: string; phone: string; line1: string; line2?: string; landmark?: string; city: string; state: string; postalCode: string; location?: { lat?: string; lon?: string }; isDefault?: boolean };
type RazorpayResult = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};
type OrderConfirmation = {
  orderNumber: string;
  paymentMethod: "razorpay" | "cod";
  total: number;
  unitCount: number;
};
type RazorpayCheckout = {
  open(): void;
  on(
    event: "payment.failed",
    callback: (response: { error: { description?: string } }) => void,
  ): void;
};
declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

const categories = [
  "All",
  "Stationery",
  "Personal Care",
  "Kids",
  "Electronics",
  "Beauty",
  "Decor",
];
const ONLINE_PAYMENT_ENABLED = false;
const categoryIcons: Record<string, string> = {
  All: "⌂",
  Stationery: "✏️",
  "Personal Care": "🧴",
  Kids: "🧸",
  Electronics: "🔌",
  Beauty: "✨",
  Decor: "🏠",
};

function ProductSkeleton() {
  return (
    <div className="store-grid" aria-label="Loading products" aria-busy="true">
      {Array.from({ length: 8 }, (_, index) => (
        <article className="product-card product-skeleton" key={index}>
          <span className="skeleton product-image-skeleton" />
          <div className="product-copy">
            <span className="skeleton skeleton-line skeleton-title" />
            <span className="skeleton skeleton-line skeleton-description" />
            <span className="skeleton skeleton-line skeleton-price" />
          </div>
          <span className="skeleton skeleton-button" />
        </article>
      ))}
    </div>
  );
}

function ProductImageCarousel({ product }: { product: Product }) {
  const legacyImages = Array.isArray(product.imageUrl) ? product.imageUrl : product.imageUrl ? [product.imageUrl] : [];
  const images = product.imageUrls?.filter(Boolean).length ? product.imageUrls.filter(Boolean) : legacyImages;
  const [activeImage, setActiveImage] = useState(0);
  if (!images.length) return <div className="product-image"><span>{product.icon || "📦"}</span></div>;
  const current = images[activeImage] || images[0];
  const change = (direction: number) => setActiveImage(index => (index + direction + images.length) % images.length);
  return <div className="product-image product-carousel"><img src={current} alt={product.name} />{images.length > 1 && <><button className="carousel-arrow previous" onClick={() => change(-1)} aria-label={`Previous ${product.name} image`}>‹</button><button className="carousel-arrow next" onClick={() => change(1)} aria-label={`Next ${product.name} image`}>›</button><div className="carousel-dots">{images.map((_, index) => <button key={index} className={index === activeImage ? "active" : ""} onClick={() => setActiveImage(index)} aria-label={`Show image ${index + 1}`} />)}</div></>}</div>;
}

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
  const [knownProducts, setKnownProducts] = useState<Record<string, Product>>(
    {},
  );
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [confirmed, setConfirmed] = useState<OrderConfirmation | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [addresses, setAddresses] = useState<DeliveryAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [addressOpen, setAddressOpen] = useState(false);
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressForm, setAddressForm] = useState({ label: "Home", recipientName: "", phone: "", line1: "", line2: "", landmark: "", city: "", state: "", postalCode: "", location: undefined as DeliveryAddress["location"], isDefault: false });
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      firebaseAuth
        ? onIdTokenChanged(firebaseAuth, (value) => {
            setUser(value);
            setAuthReady(true);
          })
        : (setAuthReady(true), undefined),
    [],
  );
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("addresses") === "1") setAddressOpen(true);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);
  const loadAddresses = async () => {
    const token = await firebaseAuth?.currentUser?.getIdToken();
    if (!token) return;
    const response = await fetch("/api/addresses", { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load addresses.");
    setAddresses(data.addresses || []); setSelectedAddressId((current) => current || data.addresses?.[0]?.id || "");
  };
  useEffect(() => { if (user) loadAddresses().catch(() => undefined); else { setAddresses([]); setSelectedAddressId(""); } }, [user]);
  useEffect(() => {
    if (!user) return;
    user.getIdToken().then((token) => fetch("/api/user-role", { headers: { Authorization: `Bearer ${token}` } })).catch(() => undefined);
  }, [user]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(
      `/api/inventory?categoryType=${encodeURIComponent(category)}&search=${encodeURIComponent(search)}&page=${page}&limit=50`,
      { signal: controller.signal },
    )
      .then((response) => response.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setProducts((old) =>
          page === 1 ? data.items || [] : [...old, ...(data.items || [])],
        );
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
        setKnownProducts((old) => ({
          ...old,
          ...Object.fromEntries(
            (data.items as Product[]).map((item) => [item.id, item]),
          ),
        }));
        setError("");
      })
      .catch((reason) => {
        if (reason.name !== "AbortError")
          setError(reason.message || "We could not load the catalogue.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [category, search, page]);
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || loading || page >= totalPages) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting)
          setPage((current) => (current < totalPages ? current + 1 : current));
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loading, page, totalPages]);
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
    0,
  );
  const delivery = subtotal >= 199 ? 0 : 20;
  const orderTotal = subtotal + delivery;
  const cartItems = useMemo(
    () =>
      Object.entries(cart)
        .filter(([, quantity]) => quantity > 0)
        .map(([id, quantity]) => ({ product: knownProducts[id], quantity }))
        .filter(({ product }) => product),
    [cart, knownProducts],
  );
  function qty(id: string, delta: number) {
    setCart((old) => ({ ...old, [id]: Math.max(0, (old[id] || 0) + delta) }));
  }
  async function checkout(paymentMethod: "razorpay" | "cod") {
    if (!user) {
      setAuthOpen(true);
      toast.error("Please sign in before placing an order.");
      return;
    }
    const selectedAddress = addresses.find((address) => address.id === selectedAddressId);
    if (!selectedAddress) { setAddressOpen(true); toast.error("Add a delivery address before checkout."); return; }
    const idToken = await user.getIdToken();
    if (!idToken) { toast.error("Your sign-in session expired. Please sign in again."); return; }
    setPaying(true);
    setError("");
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}`, "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          paymentMethod,
          address: selectedAddress,
          items: Object.entries(cart)
            .filter(([, q]) => q > 0)
            .map(([id, quantity]) => ({ id, quantity })),
        }),
      });
      const order = await response.json();
      if (!response.ok) throw new Error(order.error);
      if (paymentMethod === "cod") {
        setConfirmed({
          orderNumber: order.orderNumber,
          paymentMethod: "cod",
          total: order.total,
          unitCount: units,
        });
        setCart({});
        setCartOpen(false);
        toast.success("Cash on Delivery order placed successfully.");
        return;
      }
      if (!window.Razorpay)
        throw new Error("Payment is loading. Please try again.");
      const checkoutModal = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "Aaroda Books and Stationery",
        description: `Order ${order.orderNumber}`,
        order_id: order.razorpayOrderId,
        prefill: { name: user?.displayName || "", email: user?.email || "" },
        theme: { color: "#126b53" },
        handler: async (result: RazorpayResult) => {
          try {
            const verified = await fetch("/api/orders/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...result,
                mongoOrderId: order.mongoOrderId,
              }),
            });
            const verification = await verified.json();
            if (!verified.ok)
              throw new Error(
                verification.error || "Payment could not be verified",
              );
            setConfirmed({
              orderNumber: order.orderNumber,
              paymentMethod: "razorpay",
              total: order.total,
              unitCount: units,
            });
            setCart({});
            setCartOpen(false);
            toast.success("Payment verified. Your order is confirmed.");
          } catch (reason) {
            const message =
              reason instanceof Error
                ? reason.message
                : "Payment verification failed";
            toast.error(message);
          }
        },
        modal: {
          ondismiss: () => {
            setPaying(false);
            toast.info("Payment cancelled. Your basket is still saved.");
          },
        },
      });
      checkoutModal.on("payment.failed", (event) => {
        const message =
          event.error.description || "Payment failed. Please try again.";
        toast.error(message);
        setPaying(false);
      });
      checkoutModal.open();
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Unable to place order";
      toast.error(message);
    } finally {
      setPaying(false);
    }
  }
  const chooseCategory = (next: string) => {
    setCategory(next);
    setPage(1);
  };
  async function saveAddress(event: React.FormEvent) {
    event.preventDefault(); const token = await firebaseAuth?.currentUser?.getIdToken(); if (!token) return;
    setAddressSaving(true);
    try { const response = await fetch("/api/addresses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...addressForm, isDefault: !addresses.length || addressForm.isDefault }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not save address."); setAddresses((current) => [data.address, ...current.map((address) => addressForm.isDefault ? { ...address, isDefault: false } : address)]); setSelectedAddressId(data.address.id); setAddressOpen(false); toast.success("Delivery address saved."); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save address."); } finally { setAddressSaving(false); }
  }
  function useCurrentLocation() {
    if (!navigator.geolocation) { toast.error("Location is not supported by this browser."); return; }
    navigator.geolocation.getCurrentPosition(async ({ coords }) => { try { const response = await fetch(`/api/addresses/geocode?lat=${coords.latitude}&lon=${coords.longitude}`); const data = await response.json(); const address = data.results?.[0]?.address || {}; setAddressForm((current) => ({ ...current, line1: current.line1 || String(address.road || address.neighbourhood || ""), city: current.city || String(address.city || address.town || address.village || ""), state: current.state || String(address.state || ""), postalCode: current.postalCode || String(address.postcode || ""), location: { lat: String(coords.latitude), lon: String(coords.longitude) } })); toast.success("Location found. Please confirm the address details."); } catch { toast.info("Location found. Please complete the address manually."); } }, () => toast.error("We could not access your location."), { enableHighAccuracy: false, timeout: 10000 });
  }

  if (viewMode === "admin" && isAdminEmail(user?.email))
    return (
      <>
        <StoreNav
          cartCount={units}
          user={user}
          adminMode
          onAuth={() => setAuthOpen(true)}
          onSignOut={() => firebaseAuth && signOut(firebaseAuth)}
          onStore={() => setViewMode("store")}
          onAdmin={() => setViewMode("store")}
          onAddresses={() => location.assign("/?addresses=1")}
        />
        <AdminDashboard
          onSwitchToStore={() => setViewMode("store")}
          onInventoryUpdated={() => setPage(1)}
        />
        {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
      </>
    );
  if (confirmed)
    return (
      <div className="storefront">
        <StoreNav
          cartCount={units}
          user={user}
          adminMode={false}
          onAuth={() => setAuthOpen(true)}
          onSignOut={() => firebaseAuth && signOut(firebaseAuth)}
          onStore={() => setConfirmed(null)}
          onAdmin={() => setViewMode("admin")}
          onAddresses={() => location.assign("/?addresses=1")}
        />
        <main className="success">
          <section>
            <div>✓</div>
            <p>
              {confirmed.paymentMethod === "cod"
                ? "ORDER PLACED"
                : "ORDER CONFIRMED"}
            </p>
            <h1>Thank you!</h1>
            <span>{confirmed.orderNumber}</span>
            <p>
              {confirmed.unitCount} item{confirmed.unitCount === 1 ? "" : "s"} ·
              Total ₹{confirmed.total}
            </p>
            <p>
              {confirmed.paymentMethod === "cod"
                ? "Cash on Delivery selected. Please keep the exact amount ready at delivery."
                : "Aaroda Books and Stationery has received your paid order."}
            </p>
            <button onClick={() => setConfirmed(null)}>
              Continue shopping
            </button>
          </section>
        </main>
        {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
      </div>
    );
  return (
    <div className="storefront">
      <StoreNav
        cartCount={units}
        user={user}
        adminMode={false}
        onAuth={() => setAuthOpen(true)}
        onSignOut={() => firebaseAuth && signOut(firebaseAuth)}
        onStore={() => {}}
        onAdmin={() => setViewMode("admin")}
        onAddresses={() => setAddressOpen(true)}
      />
      <main className="store-main">
        <section className="store-hero">
          <p className="eyebrow">Aaroda Books & Stationery</p>
          {!authReady ? (
            <>
              <span className="skeleton welcome-skeleton" />
              <span className="skeleton welcome-skeleton short" />
            </>
          ) : (
            user && (
              <h2 className="welcome-title">
                Welcome,{" "}
                {user.displayName?.split(" ")[0] || user.email?.split("@")[0]}
              </h2>
            )
          )}
          <h1>
            Your everyday essentials, <em>ready to order.</em>
          </h1>
          <p>
            Browse what is in stock, add it to your basket, and check out
            securely.
          </p>
          <div className="hero-pills">
            <span>⚡ Fast delivery</span>
            <span>● Live inventory</span>
            <span>🔒 Secure payment</span>
          </div>
        </section>
        <section className="catalogue" aria-label="Product catalogue">
          <div className="catalogue-heading">
            <div>
              <p className="eyebrow">SHOP THE CATALOGUE</p>
              <h2>Find what you need</h2>
            </div>
            <span>{loading ? "Updating…" : `${total} items available`}</span>
          </div>
          <label className="store-search">
            <span>⌕</span>
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search books, pens, essentials…"
            />
            <button
              type="button"
              aria-label="Clear search"
              hidden={!searchInput}
              onClick={() => setSearchInput("")}
            >
              ×
            </button>
          </label>
          <div className="category-showcase" role="tablist" aria-label="Shop by category">
            {categories.map((item) => (
              <button
                key={item}
                role="tab"
                aria-selected={category === item}
                className={`category-card ${category === item ? "active" : ""}`}
                onClick={() => chooseCategory(item)}
              >
                <span className="category-card-icon">{categoryIcons[item]}</span>
                <b>{item === "All" ? "Everything" : item}</b>
                <small>{item === "All" ? "Browse all" : "Shop now"}</small>
              </button>
            ))}
          </div>
          {error && (
            <div className="store-error" role="alert">
              {error}
              <button onClick={() => setPage(page)}>Try again</button>
            </div>
          )}
          {loading ? (
            <ProductSkeleton />
          ) : products.length ? (
            <div className="store-grid">
              {products.map((item) => (
                <article className="product-card" key={item.id}>
                  <ProductImageCarousel product={item} />
                  <div className="product-copy">
                    <p>{item.category}</p>
                    <h3>{item.name}</h3>
                    <small>
                      {item.description ||
                        `${item.stock} ${item.unit} available`}
                    </small>
                    <strong>
                      ₹{item.price}{" "}
                      {item.mrp > item.price && <s>₹{item.mrp}</s>}
                    </strong>
                  </div>
                  {!cart[item.id] ? (
                    <button
                      className="add-to-cart"
                      onClick={() => qty(item.id, 1)}
                    >
                      Add <span>+</span>
                    </button>
                  ) : (
                    <div className="product-quantity">
                      <button
                        aria-label={`Remove ${item.name}`}
                        onClick={() => qty(item.id, -1)}
                      >
                        −
                      </button>
                      <b>{cart[item.id]}</b>
                      <button
                        aria-label={`Add another ${item.name}`}
                        onClick={() => qty(item.id, 1)}
                      >
                        +
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-catalogue">
              <span>🛍️</span>
              <h3>No matches found</h3>
              <p>Try another search or choose a different category.</p>
              <button
                onClick={() => {
                  setSearchInput("");
                  chooseCategory("All");
                }}
              >
                Browse all items
              </button>
            </div>
          )}
          {page < totalPages && (
            <div ref={loadMoreRef} className="infinite-loader">
              {loading ? "Loading more items…" : "Scroll for more items"}
            </div>
          )}
        </section>
      </main>
      {units > 0 && (
        <button className="basket-bar" onClick={() => setCartOpen(true)}>
          <span className="basket-count">{units}</span>
          <span>
            <b>View basket</b>
            <small>
              {units} item{units !== 1 ? "s" : ""} · ₹{subtotal}
            </small>
          </span>
          <strong>Checkout →</strong>
        </button>
      )}
      {cartOpen && (
        <div
          className="cart-overlay"
          role="presentation"
          onMouseDown={() => setCartOpen(false)}
        >
          <aside
            className="cart-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Your basket"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p className="eyebrow">YOUR BASKET</p>
                <h2>Ready when you are</h2>
              </div>
              <button
                aria-label="Close basket"
                onClick={() => setCartOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="cart-items">
              {cartItems.map(
                ({ product, quantity }) =>
                  product && (
                    <article key={product.id}>
                      <div className="cart-icon">
                        {(product.imageUrls?.[0] || (Array.isArray(product.imageUrl) ? product.imageUrl[0] : product.imageUrl)) ? (
                          <img src={product.imageUrls?.[0] || (Array.isArray(product.imageUrl) ? product.imageUrl[0] : product.imageUrl)} alt="" />
                        ) : (
                          product.icon
                        )}
                      </div>
                      <div>
                        <b>{product.name}</b>
                        <small>₹{product.price} each</small>
                        <div className="cart-quantity">
                          <button onClick={() => qty(product.id, -1)}>−</button>
                          <span>{quantity}</span>
                          <button onClick={() => qty(product.id, 1)}>+</button>
                        </div>
                      </div>
                      <strong>₹{product.price * quantity}</strong>
                    </article>
                  ),
              )}
            </div>
            <footer>
              <div>
                <span>Items total</span>
                <b>₹{subtotal}</b>
              </div>
              <div>
                <span>Delivery</span>
                <b>{delivery === 0 ? <><s>₹20</s> <em>FREE</em></> : `₹${delivery}`}</b>
              </div>
              {delivery > 0 && <p className="delivery-hint">Add ₹{199 - subtotal} more for free delivery.</p>}
              <div className="cart-total">
                <span>Total</span>
                <b>₹{orderTotal}</b>
              </div>
              <section className="delivery-address-summary">
                <div><b>Deliver to</b>{addresses.find((address) => address.id === selectedAddressId) ? <small>{addresses.find((address) => address.id === selectedAddressId)?.label} · {addresses.find((address) => address.id === selectedAddressId)?.line1}</small> : <small>Add your delivery address</small>}</div>
                <button type="button" onClick={() => setAddressOpen(true)}>Change</button>
              </section>
              <div className="checkout-actions">
                {ONLINE_PAYMENT_ENABLED && <button
                  className="checkout-button"
                  onClick={() => checkout("razorpay")}
                  disabled={paying}
                >
                  {paying ? "Preparing secure payment…" : "Pay online →"}
                </button>}
                <button
                  className="checkout-button cod-checkout"
                  onClick={() => checkout("cod")}
                  disabled={paying}
                  aria-busy={paying}
                >
                  {paying ? <><span className="checkout-button-loader" aria-hidden="true" /> Processing order…</> : "Cash on Delivery"}
                </button>
              </div>
            </footer>
          </aside>
        </div>
      )}
      {addressOpen && <div className="address-overlay" onMouseDown={() => setAddressOpen(false)}><section className="address-modal" role="dialog" aria-modal="true" aria-label="Delivery address" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">DELIVERY ADDRESS</p><h2>Where should we deliver?</h2></div><button onClick={() => setAddressOpen(false)} aria-label="Close">×</button></header>{addresses.length > 0 && <div className="saved-addresses">{addresses.map((address) => <button type="button" key={address.id} className={selectedAddressId === address.id ? "selected" : ""} onClick={() => { setSelectedAddressId(address.id); setAddressOpen(false); }}><b>{address.label}{address.isDefault ? " · Default" : ""} · {address.recipientName}</b><small>{address.line1}, {address.city}, {address.state} — {address.postalCode}</small></button>)}</div>}<form className="address-form" onSubmit={saveAddress}><div className="address-form-top"><b>Add a new address</b><button type="button" onClick={useCurrentLocation}>⌖ Use my location</button></div><div className="address-grid"><label>Label<input value={addressForm.label} onChange={(e) => setAddressForm({ ...addressForm, label: e.target.value })} required /></label><label>Name<input value={addressForm.recipientName} onChange={(e) => setAddressForm({ ...addressForm, recipientName: e.target.value })} required /></label><label>Mobile<input inputMode="numeric" value={addressForm.phone} onChange={(e) => setAddressForm({ ...addressForm, phone: e.target.value })} required /></label><label>House / building<input value={addressForm.line1} onChange={(e) => setAddressForm({ ...addressForm, line1: e.target.value })} required /></label><label>Area / street<input value={addressForm.line2} onChange={(e) => setAddressForm({ ...addressForm, line2: e.target.value })} /></label><label>Landmark<input value={addressForm.landmark} onChange={(e) => setAddressForm({ ...addressForm, landmark: e.target.value })} /></label><label>City<input value={addressForm.city} onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })} required /></label><label>State<input value={addressForm.state} onChange={(e) => setAddressForm({ ...addressForm, state: e.target.value })} required /></label><label>PIN code<input inputMode="numeric" value={addressForm.postalCode} onChange={(e) => setAddressForm({ ...addressForm, postalCode: e.target.value })} required /></label></div><label className="default-address-option"><input type="checkbox" checked={addressForm.isDefault} onChange={(e) => setAddressForm({ ...addressForm, isDefault: e.target.checked })} /> Make this my default address</label><button className="checkout-button" disabled={addressSaving}>{addressSaving ? "Saving address…" : "Save delivery address"}</button></form></section></div>}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  );
}

function StoreNav({
  cartCount,
  user,
  onAuth,
  onSignOut,
  onStore,
  onAdmin,
  onAddresses,
}: {
  cartCount: number;
  user: User | null;
  adminMode: boolean;
  onAuth: () => void;
  onSignOut: () => void;
  onStore: () => void;
  onAdmin: () => void;
  onAddresses: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [avatarImageFailed, setAvatarImageFailed] = useState(false);
  const canAdmin = isAdminEmail(user?.email);
  const profileLabel = user?.displayName || user?.email?.split("@")[0] || "User";
  const initials = profileLabel.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
  const avatarColours = ["#216e5b", "#6e4f9d", "#a8503d", "#226b96", "#8b5c25", "#9c3e71"];
  const avatarColour = avatarColours[[...profileLabel].reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 0) % avatarColours.length];
  const hasProfileImage = Boolean(user?.photoURL) && !avatarImageFailed;
  return (
    <nav className="store-nav">
      <button className="store-logo" onClick={onStore}>
        <span>A</span>
        <div>
          <b>Aaroda</b>
          <small>Books & Stationery</small>
        </div>
      </button>
      <div className="store-nav-actions">
        {user ? (
          <div className="profile-wrap">
            <button className="nav-user" onClick={() => setOpen(!open)}>
              {hasProfileImage ? <img src={user.photoURL!} alt="" onError={() => setAvatarImageFailed(true)} /> : <span className="initials-avatar" style={{ backgroundColor: avatarColour }} aria-label={`${initials} avatar`}>{initials}</span>}
              <span>
                {user.displayName?.split(" ")[0] || user.email?.split("@")[0]}
              </span>
            </button>
            {open && (
              <div className="profile-menu">
                <button onClick={() => location.assign("/orders")}>
                  📦 Orders
                </button>
                <button onClick={onAddresses}>
                  📍 Saved addresses
                </button>
                <button onClick={onSignOut}>↪ Logout</button>
              </div>
            )}
          </div>
        ) : (
          <button className="nav-admin" onClick={onAuth}>
            Sign in
          </button>
        )}
        {canAdmin && (
          <button
            className="admin-toggle"
            onClick={onAdmin}
            title="Switch to Admin mode"
          >
            ⚙ Switch to Admin
          </button>
        )}
        <button
          className="nav-basket"
          onClick={onStore}
          aria-label="Shopping basket"
        >
          🛒{cartCount > 0 && <i>{cartCount}</i>}
        </button>
      </div>
    </nav>
  );
}
