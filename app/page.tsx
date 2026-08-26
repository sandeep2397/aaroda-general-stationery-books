"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Product = { id:string; sku:string; name:string; category:"Medicine"|"Stationery"; description:string; price:number; mrp:number; stock:number; unit:string; icon:string };
type RazorpayResult = { razorpay_order_id:string; razorpay_payment_id:string; razorpay_signature:string };
declare global { interface Window { Razorpay: new (options: Record<string, unknown>) => { open(): void } } }

export default function Home() {
  const [started,setStarted]=useState(false), [category,setCategory]=useState("All"), [search,setSearch]=useState(""), [loading,setLoading]=useState(true), [error,setError]=useState("");
  const [products,setProducts]=useState<Product[]>([]), [knownProducts,setKnownProducts]=useState<Record<string,Product>>({}), [cart,setCart]=useState<Record<string,number>>({}), [paying,setPaying]=useState(false), [confirmed,setConfirmed]=useState("");

  useEffect(()=>{ if (!started) return; const controller=new AbortController(); setLoading(true); fetch(`/api/inventory?category=${encodeURIComponent(category)}&search=${encodeURIComponent(search)}`,{signal:controller.signal}).then(r=>r.json()).then(data=>{ if(data.error) throw new Error(data.error); setProducts(data.items); setKnownProducts(old=>({...old,...Object.fromEntries((data.items as Product[]).map(item=>[item.id,item]))})); setError(""); }).catch(e=>{if(e.name!=="AbortError")setError(e.message)}).finally(()=>setLoading(false)); return()=>controller.abort(); },[started,category,search]);
  useEffect(()=>{ if(document.getElementById("razorpay-checkout"))return; const script=document.createElement("script"); script.id="razorpay-checkout"; script.src="https://checkout.razorpay.com/v1/checkout.js"; script.async=true; document.body.appendChild(script); },[]);

  const units=Object.values(cart).reduce((a,b)=>a+b,0), subtotal=Object.entries(cart).reduce((sum,[id,quantity])=>sum+(knownProducts[id]?.price||0)*quantity,0);
  const visible=useMemo(()=>products,[products]);
  function qty(id:string,delta:number){setCart(old=>({...old,[id]:Math.max(0,(old[id]||0)+delta)}));}
  function sendHi(e?:FormEvent){e?.preventDefault();setStarted(true);setCategory("All");}
  async function checkout(){
    setPaying(true);setError("");
    try{
      const response=await fetch("/api/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:Object.entries(cart).filter(([,q])=>q>0).map(([id,quantity])=>({id,quantity}))})});
      const order=await response.json(); if(!response.ok)throw new Error(order.error);
      if(!window.Razorpay)throw new Error("Payment window is still loading. Please try again.");
      new window.Razorpay({key:order.keyId,amount:order.amount,currency:order.currency,name:"NammaCare",description:`Order ${order.orderNumber}`,order_id:order.razorpayOrderId,theme:{color:"#126b53"},handler:async(result:RazorpayResult)=>{const verified=await fetch("/api/orders/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...result,mongoOrderId:order.mongoOrderId})});if(!verified.ok)throw new Error("Payment could not be verified");setConfirmed(order.orderNumber);setCart({});}}).open();
    }catch(e){setError(e instanceof Error?e.message:"Unable to place order");}finally{setPaying(false);}
  }

  if(confirmed)return <main className="success"><section><div>✓</div><p>ORDER CONFIRMED</p><h1>Thank you!</h1><span>{confirmed}</span><p>Your neighbourhood store has received the order.</p><button onClick={()=>{setConfirmed("");setStarted(false)}}>Start another order</button></section></main>;
  return <main className="shell">
    <section className="intro"><div className="brand">ನಮ್ಮ<span>Care</span></div><p className="eyebrow">BENGALURU’S NEIGHBOURHOOD HELPER</p><h1>Everyday essentials,<br/><em>one message away.</em></h1><p className="lede">Order medicines and stationery through a simple, friendly chat. Secure test checkout included.</p><div className="features"><span>⚡ 30 min delivery</span><span>● Live inventory</span><span>⌖ Bengaluru only</span></div></section>
    <section className="phone" aria-label="NammaCare ordering assistant">
      <header><div className="avatar">ನ</div><div><b>NammaCare</b><small><i/> online</small></div><span>⌕ &nbsp; ⋮</span></header>
      <div className="chat"><div className="today">TODAY</div>
        {!started?<div className="welcome"><div className="bubble bot">Namaskara! 👋<br/>Send <b>Hi</b> to start your order.<time>10:24 AM</time></div><button onClick={()=>sendHi()}>Hi 👋</button></div>:<>
          <div className="bubble user">Hi <time>10:24 AM ✓✓</time></div><div className="bubble bot">Namaskara! 👋 What would you like to order today?<time>10:24 AM</time></div>
          <div className="categories">{["All","Medicine","Stationery"].map(c=><button key={c} className={category===c?"active":""} onClick={()=>setCategory(c)}>{c==="Medicine"?"💊 ":c==="Stationery"?"✏️ ":"⌂ "}{c}</button>)}</div>
          <section className="catalog"><label>⌕<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search inventory..."/></label><p>{loading?"CHECKING STOCK...":`${visible.length} ITEMS IN STOCK`}</p>
            <div className="items">{visible.map(item=><article key={item.id}><div className="icon">{item.icon}</div><div className="info"><b>{item.name}</b><small>{item.description}</small><strong>₹{item.price} <s>₹{item.mrp}</s></strong></div>{!cart[item.id]?<button className="add" onClick={()=>qty(item.id,1)}>ADD</button>:<div className="qty"><button onClick={()=>qty(item.id,-1)}>−</button><b>{cart[item.id]}</b><button onClick={()=>qty(item.id,1)}>+</button></div>}</article>)}</div>
          </section>
        </>}
      </div>
      {error&&<div className="error">{error}</div>}
      {units>0&&<button className="cartbar" onClick={checkout} disabled={paying}><span><b>{units} item{units!==1?"s":""}</b><small>₹{subtotal} + ₹20 delivery</small></span><strong>{paying?"Preparing…":"Pay & place order →"}</strong></button>}
      <form className="composer" onSubmit={sendHi}><button type="button">☺</button><input placeholder="Type a message"/><button className="send">➤</button></form>
    </section>
  </main>;
}
