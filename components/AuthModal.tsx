"use client";

import { FormEvent, useState } from "react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, updateProfile } from "firebase/auth";
import { firebaseAuth, firebaseEnabled, googleProvider } from "@/lib/firebase";

const emailPattern = /^\S+@\S+\.\S+$/;
const usernamePattern = /^[a-zA-Z0-9._-]{3,16}$/;

export default function AuthModal({ onClose }: { onClose: () => void }) {
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const message = (reason: unknown) => reason instanceof Error ? reason.message.replace("Firebase: ", "") : "Could not sign in.";

  async function google() {
    if (!firebaseAuth) return setError("Firebase is not configured.");
    setBusy(true); setError("");
    try { await signInWithPopup(firebaseAuth, googleProvider); onClose(); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!firebaseAuth) return setError("Firebase is not configured.");
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = username.trim();
    if (register && !usernamePattern.test(normalizedName)) return setError("Username must be 3–16 characters and use only letters, numbers, dots, hyphens, or underscores.");
    if (!emailPattern.test(normalizedEmail)) return setError("Enter a valid email address.");
    if (password.length < 8 || password.length > 16 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) return setError("Password must be 8–16 characters with uppercase, lowercase, a number, and a symbol.");
    setBusy(true); setError("");
    try {
      if (register) {
        const credential = await createUserWithEmailAndPassword(firebaseAuth, normalizedEmail, password);
        await updateProfile(credential.user, { displayName: normalizedName });
      } else await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, password);
      onClose();
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }

  return <div className="auth-overlay"><section className="auth-modal" role="dialog" aria-modal="true" aria-label={register ? "Create your account" : "Sign in to Aaroda"}>
    <button className="auth-close" onClick={onClose} aria-label="Close sign in">×</button><span className="auth-mark">A</span><p className="eyebrow">SECURE ACCOUNT</p><h2>{register ? "Create your account" : "Sign in to Aaroda"}</h2><p>Use Google or your email and password.</p>
    <button className="google-signin" disabled={busy || !firebaseEnabled} onClick={google}><span className="google-g">G</span> Continue with Google</button><div className="auth-divider"><span>or use email</span></div>
    <form onSubmit={submit} noValidate>
      {register && <><label className="auth-label" htmlFor="auth-username">Username</label><input id="auth-username" className="auth-input" type="text" autoComplete="username" minLength={3} maxLength={16} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="3–16 characters" /></>}
      <label className="auth-label" htmlFor="auth-email">Email address</label><input id="auth-email" className="auth-input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
      <label className="auth-label" htmlFor="auth-password">Password</label><input id="auth-password" className="auth-input" type="password" autoComplete={register ? "new-password" : "current-password"} minLength={8} maxLength={16} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={register ? "8–16 characters" : "Your password"} />
      {register && <small className="auth-password-help">Use uppercase, lowercase, a number, and a symbol.</small>}
      <button className="auth-primary" disabled={busy || !firebaseEnabled}>{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button>
    </form>
    <button className="auth-link" onClick={() => { setRegister((current) => !current); setError(""); }}>{register ? "Already have an account? Sign in" : "New here? Create an account"}</button>{error && <div className="auth-error" role="alert">{error}</div>}<small>Accounts and sessions are securely managed by Firebase Authentication.</small>
  </section></div>;
}
