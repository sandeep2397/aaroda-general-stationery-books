"use client";

import { FormEvent, useMemo, useRef, useState } from "react";

type Category = "Medicine" | "Stationery";
type Item = { id: number; name: string; detail: string; price: number; category: Category; icon: string };

const inventory: Item[] = [
  { id: 1, name: "Paracetamol 500mg", detail: "10 tablets • Dolo", price: 32, category: "Medicine", icon: "💊" },
  { id: 2, name: "Cetirizine 10mg", detail: "10 tablets • Generic", price: 24, category: "Medicine", icon: "💊" },
  { id: 3, name: "Digene Mint", detail: "15 tablets • Abbott", price: 29, category: "Medicine", icon: "🧴" },
  { id: 4, name: "Band-Aid Washproof", detail: "10 strips • J&J", price: 45, category: "Medicine", icon: "🩹" },
  { id: 5, name: "Vitamin C 500mg", detail: "15 tablets • Limcee", price: 38, category: "Medicine", icon: "🍊" },
  { id: 6, name: "Classmate Notebook", detail: "172 pages • Ruled", price: 65, category: "Stationery", icon: "📓" },
  { id: 7, name: "Blue Ball Pens", detail: "Pack of 5 • Reynolds", price: 50, category: "Stationery", icon: "🖊️" },
  { id: 8, name: "Apsara Pencils", detail: "Pack of 10 • Extra dark", price: 55, category: "Stationery", icon: "✏️" },
  { id: 9, name: "Sticky Notes", detail: "100 sheets • Yellow", price: 42, category: "Stationery", icon: "🗒️" },
  { id: 10, name: "Geometry Box", detail: "8-piece student set", price: 110, category: "Stationery", icon: "📐" },
];

type Message = { from: "bot" | "user"; text: string };

export default function Home() {
  const [started, setStarted] = useState(false);
  const [category, setCategory] = useState<Category | null>(null);
  const [query, setQuery] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [checkout, setCheckout] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => inventory.filter((item) =>
    (!category || item.category === category) &&
    `${item.name} ${item.detail}`.toLowerCase().includes(query.toLowerCase())
  ), [category, query]);

  const units = Object.values(cart).reduce((sum, value) => sum + value, 0);
  const subtotal = inventory.reduce((sum, item) => sum + item.price * (cart[item.id] || 0), 0);
  const delivery = subtotal ? 20 : 0;

  function begin(text = "Hi") {
    setStarted(true);
    setMessages([{ from: "user", text }, { from: "bot", text: "Namaskara! 👋 What would you like to order today?" }]);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function chooseCategory(next: Category) {
    setCategory(next);
    setQuery("");
    setMessages((prev) => [...prev, { from: "user", text: next }, { from: "bot", text: `Here are the ${next.toLowerCase()} items available near you. Search or add what you need.` }]);
  }

  function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (!started) begin(text);
    else {
      setMessages((prev) => [...prev, { from: "user", text }, { from: "bot", text: category ? `I found these results for “${text}”.` : "Choose a category below and I’ll show you what’s in stock." }]);
      if (category) setQuery(text);
    }
  }

  function changeQuantity(id: number, amount: number) {
    setCart((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) + amount) }));
  }

  if (checkout) return (
    <main className="payment-page">
      <section className="payment-card">
        <div className="pay-brand">ನಮ್ಮ<span>Care</span></div>
        <div className="pay-check">✓</div>
        <p className="eyebrow">SECURE UPI CHECKOUT</p>
        <h1>Pay ₹{subtotal + delivery}</h1>
        <p className="muted">Order NC-{String(Date.now()).slice(-6)} • {units} item{units !== 1 ? "s" : ""}</p>
        <button className="upi-option" onClick={() => alert("Payment demo complete — your order is confirmed!")}>◉ &nbsp; Pay with any UPI app <span>›</span></button>
        <button className="back-link" onClick={() => setCheckout(false)}>← Back to order</button>
        <small>Prototype checkout • No payment will be collected</small>
      </section>
    </main>
  );

  return (
    <main className="shell">
      <section className="intro">
        <div className="brand-mark">ನಮ್ಮ<span>Care</span></div>
        <p className="eyebrow">BENGALURU’S NEIGHBOURHOOD HELPER</p>
        <h1>Everyday essentials,<br /><em>one message away.</em></h1>
        <p className="lede">Order medicines and stationery through a simple, friendly chat. No app download. No long forms.</p>
        <div className="feature-row">
          <span>⚡ 30 min delivery</span><span>● Live inventory</span><span>⌖ Bengaluru only</span>
        </div>
      </section>

      <section className="phone" aria-label="NammaCare order chat">
        <header className="chat-header">
          <div className="avatar">ನ</div>
          <div><strong>NammaCare</strong><small><i /> online</small></div>
          <div className="header-actions">⌕ &nbsp; ⋮</div>
        </header>

        <div className="chat-body">
          <div className="day-pill">TODAY</div>
          {!started ? (
            <div className="welcome">
              <div className="bot-bubble">Namaskara! 👋<br />Send <b>Hi</b> to start your order.<time>10:24 AM</time></div>
              <button className="hi-button" onClick={() => begin()}>Hi 👋</button>
            </div>
          ) : (
            <>
              {messages.map((message, index) => (
                <div className={`bubble ${message.from}`} key={`${message.text}-${index}`}>{message.text}<time>10:24 AM {message.from === "user" && "✓✓"}</time></div>
              ))}
              {!category && <div className="category-grid">
                <button onClick={() => chooseCategory("Medicine")}><span>💊</span><b>Medicine</b><small>Health essentials</small></button>
                <button onClick={() => chooseCategory("Stationery")}><span>✏️</span><b>Stationery</b><small>School & office</small></button>
              </div>}
              {category && <div className="inventory-panel">
                <div className="inventory-top">
                  <button onClick={() => setCategory(null)}>‹</button>
                  <label><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${category.toLowerCase()}...`} /></label>
                </div>
                <p className="result-count">{items.length} ITEMS IN STOCK</p>
                <div className="item-list">
                  {items.map((item) => <article className="item" key={item.id}>
                    <div className="item-icon">{item.icon}</div>
                    <div className="item-info"><b>{item.name}</b><small>{item.detail}</small><strong>₹{item.price}</strong></div>
                    {(cart[item.id] || 0) === 0 ? <button className="add" onClick={() => changeQuantity(item.id, 1)}>ADD</button> :
                      <div className="qty"><button onClick={() => changeQuantity(item.id, -1)}>−</button><b>{cart[item.id]}</b><button onClick={() => changeQuantity(item.id, 1)}>+</button></div>}
                  </article>)}
                  {!items.length && <div className="empty">No items found. Try another search.</div>}
                </div>
              </div>}
            </>
          )}
        </div>

        {units > 0 && <button className="cart-bar" onClick={() => setCheckout(true)}><span><b>{units} item{units !== 1 ? "s" : ""}</b><small>₹{subtotal} + ₹{delivery} delivery</small></span><strong>Place order →</strong></button>}
        <form className="composer" onSubmit={send}>
          <button type="button" aria-label="Emoji">☺</button>
          <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a message" />
          <button type="submit" className="send" aria-label="Send message">➤</button>
        </form>
      </section>
    </main>
  );
}
