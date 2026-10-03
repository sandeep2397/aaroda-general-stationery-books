"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { onIdTokenChanged, signOut, User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";

type OrderLine = {
  name: string;
  sku: string;
  quantity: number;
  price: number;
  lineTotal: number;
  productSnapshot?: { unit?: string; imageUrl?: string | null };
};
type CustomerOrder = {
  id: string;
  orderNumber: string;
  lines: OrderLine[];
  summary?: {
    itemCount?: number;
    unitCount?: number;
    subtotal?: number;
    delivery?: number;
    total?: number;
  };
  total: number;
  currency: string;
  paymentMethod?: string;
  paymentStatus: string;
  orderStatus: string;
  createdAt: string;
  expiresAt?: string;
};
const money = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount || 0);

export default function OrdersPage() {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [orders, setOrders] = useState<CustomerOrder[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [paymentMethod, setPaymentMethod] = useState("all"),
    [sort, setSort] = useState("newest"),
    [page, setPage] = useState(1),
    [hasMore, setHasMore] = useState(false),
    [selectedOrder, setSelectedOrder] = useState<CustomerOrder | null>(null),
    [profileOpen, setProfileOpen] = useState(false);
  useEffect(
    () =>
      firebaseAuth
        ? onIdTokenChanged(firebaseAuth, (value) => {
            setUser(value);
            setReady(true);
          })
        : (setReady(true), undefined),
    [],
  );
  useEffect(() => {
    if (!user) {
      setOrders([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        setLoading(true);
        setError("");
        try {
          const token = await user.getIdToken();
          const params = new URLSearchParams({
            search,
            status,
            paymentMethod,
            sort,
            page: String(page),
            limit: "50",
          });
          const response = await fetch(`/api/orders/mine?${params}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
            cache: "no-store",
          });
          const data = await response.json();
          if (!response.ok)
            throw new Error(data.error || "Unable to load orders");
          setOrders((current) =>
            page === 1
              ? data.orders || []
              : [...current, ...(data.orders || [])],
          );
          setHasMore(Boolean(data.hasMore));
        } catch (reason) {
          if ((reason as Error).name !== "AbortError")
            setError(
              reason instanceof Error
                ? reason.message
                : "Unable to load orders",
            );
        } finally {
          setLoading(false);
        }
      },
      search ? 250 : 0,
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [user, search, status, paymentMethod, sort, page]);
  const countLabel = useMemo(
    () => `${orders.length} order${orders.length === 1 ? "" : "s"}`,
    [orders.length],
  );
  const displayName = (
    user?.displayName?.split(" ")[0] ||
    user?.email?.split("@")[0] ||
    "Account"
  ).toUpperCase();

  return (
    <div className="customer-orders-page">
      <nav className="store-nav customer-orders-nav">
        <Link className="store-logo" href="/home">
          <span>A</span>
          <div>
            <b>Aaroda</b>
            <small>Books & Stationery</small>
          </div>
        </Link>
        <div className="store-nav-actions">
          <Link
            className="nav-basket"
            href="/home"
            aria-label="Continue shopping"
          >
            🛍️
          </Link>
          {user ? (
            <div className="profile-wrap">
              <button
                className="nav-user"
                onClick={() => setProfileOpen((value) => !value)}
              >
                {user.photoURL ? <img src={user.photoURL} alt="" /> : "👤"}
                <span>{displayName}</span>
              </button>
              {profileOpen && (
                <div className="profile-menu">
                  <button onClick={() => setProfileOpen(false)}>
                    📦 Orders
                  </button>
                  <button onClick={() => firebaseAuth && signOut(firebaseAuth)}>
                    ↪ Logout
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link className="nav-admin" href="/home">
              Sign in
            </Link>
          )}
        </div>
      </nav>
      <main className="admin-shell customer-orders-shell">
        <div className="admin-header">
          <div className="admin-title">
            <p className="eyebrow">YOUR ACCOUNT</p>
            <h1>Your Orders</h1>
            <p>
              Review your complete order history, payment status, and item-level
              details.
            </p>
          </div>
          <Link className="btn-secondary" href="/home">
            🛍️ Continue shopping
          </Link>
        </div>
        {!ready || loading ? (
          <OrderSkeleton />
        ) : !user ? (
          <EmptyOrders
            icon="🔐"
            title="Sign in to see your orders"
            message="Orders are securely linked to your Aaroda account."
          />
        ) : (
          <>
            <section
              className="orders-controls admin-card"
              aria-label="Order filters"
            >
              <label className="orders-search-field">
                <span>⌕</span>
                <input
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                  placeholder="Search by order, item, or SKU"
                  aria-label="Search orders"
                />
              </label>
              <label className="orders-select-field">
                <span>Status</span>
                <select
                  value={status}
                  onChange={(event) => { setStatus(event.target.value); setPage(1); }}
                  aria-label="Filter by order status"
                >
                  <option value="all">All statuses</option>
                  <option value="placed">Placed</option>
                  <option value="awaiting_payment">Awaiting payment</option>
                  <option value="expired">Expired</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label className="orders-select-field">
                <span>Payment</span>
                <select
                  value={paymentMethod}
                  onChange={(event) => { setPaymentMethod(event.target.value); setPage(1); }}
                  aria-label="Filter by payment method"
                >
                  <option value="all">All payment methods</option>
                  <option value="razorpay">Online payment</option>
                  <option value="cod">Cash on Delivery</option>
                </select>
              </label>
              <label className="orders-select-field">
                <span>Sort</span>
                <select
                  value={sort}
                  onChange={(event) => { setSort(event.target.value); setPage(1); }}
                  aria-label="Sort orders"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="total_high">Total: high to low</option>
                  <option value="total_low">Total: low to high</option>
                </select>
              </label>
            </section>
            <p className="orders-count">
              {countLabel} · Select an order number to see full details
            </p>
            {error ? (
              <EmptyOrders
                icon="⚠️"
                title="We could not load your orders"
                message={error}
              />
            ) : orders.length ? (
              <section className="admin-card">
                <div className="table-responsive">
                  <table className="admin-table customer-orders-table">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Items</th>
                        <th>Total</th>
                        <th>Payment</th>
                        <th>Order Status</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order) => (
                        <tr key={order.id}>
                          <td>
                            <button
                              className="order-number-button"
                              onClick={() => setSelectedOrder(order)}
                            >
                              {order.orderNumber}
                            </button>
                            <small className="block text-gray-500">
                              View details →
                            </small>
                          </td>
                          <td>
                            <b>{order.lines[0]?.name || "Order item"}</b>
                            <small className="block text-gray-500">
                              {order.lines.length > 1 ? `+ ${order.lines.length - 1} more item(s) · ` : ""}
                              {order.summary?.unitCount || order.lines.reduce((sum, line) => sum + line.quantity, 0)} item(s)
                            </small>
                          </td>
                          <td className="font-bold text-emerald-900">
                            {money(order.total)}
                          </td>
                          <td>
                            <span className="badge badge-blue">
                              {order.paymentMethod === "cod" ? "COD" : "Online"}
                            </span>
                            <small className="block text-gray-500">
                              {order.paymentStatus.replaceAll("_", " ")}
                            </small>
                          </td>
                          <td>
                            <span
                              className={`badge ${order.orderStatus === "placed" ? "badge-green" : order.orderStatus === "expired" || order.orderStatus === "cancelled" ? "badge-gray" : "badge-blue"}`}
                            >
                              {order.orderStatus.replaceAll("_", " ")}
                            </span>
                          </td>
                          <td className="text-xs text-gray-600">
                            {new Date(order.createdAt).toLocaleString("en-IN")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : (
              <EmptyOrders
                icon="📦"
                title="No matching orders"
                message="Try a different search or filter, or place your first order."
              />
            )}
            {hasMore && !loading && <button className="orders-load-more" onClick={() => setPage(current => current + 1)}>Load 50 more orders</button>}
          </>
        )}
      </main>
      {selectedOrder && (
        <OrderDrawer
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
        />
      )}
    </div>
  );
}

function EmptyOrders({
  icon,
  title,
  message,
}: {
  icon: string;
  title: string;
  message: string;
}) {
  return (
    <section className="orders-empty admin-card">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{message}</p>
      <Link href="/home">Browse catalogue</Link>
    </section>
  );
}
function OrderSkeleton() {
  return (
    <section className="admin-card orders-loading" aria-busy="true">
      {Array.from({ length: 6 }, (_, index) => (
        <span className="skeleton" key={index} />
      ))}
    </section>
  );
}
function OrderDrawer({
  order,
  onClose,
}: {
  order: CustomerOrder;
  onClose: () => void;
}) {
  return (
    <div
      className="order-drawer-overlay"
      onMouseDown={onClose}
      role="presentation"
    >
      <aside
        className="order-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Order ${order.orderNumber}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">ORDER DETAILS</p>
            <h2>{order.orderNumber}</h2>
            <small>{new Date(order.createdAt).toLocaleString("en-IN")}</small>
          </div>
          <button onClick={onClose} aria-label="Close order details">
            ×
          </button>
        </header>
        <div className="order-drawer-body">
          <div className="order-detail-grid">
            <span>
              <small>Order status</small>
              <b>{order.orderStatus.replaceAll("_", " ")}</b>
            </span>
            <span>
              <small>Payment</small>
              <b>
                {order.paymentMethod === "cod"
                  ? "Cash on Delivery"
                  : "Online payment"}
              </b>
            </span>
            <span>
              <small>Payment status</small>
              <b>{order.paymentStatus.replaceAll("_", " ")}</b>
            </span>
            <span>
              <small>Order total</small>
              <b>{money(order.total)}</b>
            </span>
          </div>
          <h3>Items</h3>
          {order.lines.map((line, index) => (
            <article className="drawer-line" key={`${line.sku}-${index}`}>
              <div>
                {line.productSnapshot?.imageUrl ? (
                  <img src={line.productSnapshot.imageUrl} alt="" />
                ) : (
                  <span>📦</span>
                )}
                <div>
                  <b>{line.name}</b>
                  <small>
                    {line.sku} · {line.productSnapshot?.unit || "unit"}
                  </small>
                  <small>
                    {line.quantity} × {money(line.price)}
                  </small>
                </div>
              </div>
              <strong>{money(line.lineTotal)}</strong>
            </article>
          ))}
          <div className="drawer-total">
            <span>
              Items subtotal{" "}
              <b>{money(order.summary?.subtotal ?? order.total)}</b>
            </span>
            <span>
              Delivery <b>{money(order.summary?.delivery || 0)}</b>
            </span>
            <span>
              Total <b>{money(order.total)}</b>
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}
