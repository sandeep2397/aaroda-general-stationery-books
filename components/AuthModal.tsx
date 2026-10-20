"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ConfirmationResult, createUserWithEmailAndPassword, RecaptchaVerifier, signInWithEmailAndPassword, signInWithPhoneNumber, signInWithPopup, updateProfile } from "firebase/auth";
import { firebaseAuth, firebaseEnabled, googleProvider } from "@/lib/firebase";

const emailPattern = /^\S+@\S+\.\S+$/;
const usernamePattern = /^[a-zA-Z0-9._ -]{3,16}$/;
type SignInMethod = "email" | "phone";
const PHONE_OTP_ENABLED = false;

export default function AuthModal({ onClose }: { onClose: () => void }) {
  const [register, setRegister] = useState(false), [method, setMethod] = useState<SignInMethod>("email");
  const [username, setUsername] = useState(""), [email, setEmail] = useState(""), [password, setPassword] = useState(""), [showPassword, setShowPassword] = useState(false);
  const [firstName, setFirstName] = useState(""), [lastName, setLastName] = useState(""), [phone, setPhone] = useState(""), [otp, setOtp] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);
  const message = (reason: unknown) => reason instanceof Error ? reason.message.replace("Firebase: ", "") : "Could not sign in.";
  const cleanPhone = phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");

  useEffect(() => () => { recaptchaRef.current?.clear(); recaptchaRef.current = null; }, []);
  function resetPhoneFlow() { setConfirmation(null); setOtp(""); setError(""); recaptchaRef.current?.clear(); recaptchaRef.current = null; }
  function getRecaptcha() {
    if (!firebaseAuth) throw new Error("Firebase is not configured.");
    if (!recaptchaRef.current) recaptchaRef.current = new RecaptchaVerifier(firebaseAuth, "firebase-phone-recaptcha", { size: "invisible" });
    return recaptchaRef.current;
  }
  async function google() {
    if (!firebaseAuth) return setError("Firebase is not configured.");
    setBusy(true); setError("");
    try { await signInWithPopup(firebaseAuth, googleProvider); onClose(); } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  }
  async function sendOtp(event: FormEvent) {
    event.preventDefault();
    if (!firebaseAuth) return setError("Firebase is not configured.");
    if (!firstName.trim() || !lastName.trim()) return setError("Enter your first and last name.");
    if (!/^\d{10}$/.test(cleanPhone)) return setError("Enter a valid 10-digit Indian mobile number.");
    setBusy(true); setError("");
    try { setConfirmation(await signInWithPhoneNumber(firebaseAuth, `+91${cleanPhone}`, getRecaptcha())); }
    catch (reason) { resetPhoneFlow(); setError(message(reason)); } finally { setBusy(false); }
  }
  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    if (!confirmation) return;
    if (!/^\d{6}$/.test(otp.replace(/\D/g, ""))) return setError("Enter the 6-digit OTP.");
    setBusy(true); setError("");
    try {
      const credential = await confirmation.confirm(otp.replace(/\D/g, ""));
      await updateProfile(credential.user, { displayName: `${firstName.trim()} ${lastName.trim()}` });
      onClose();
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!firebaseAuth) return setError("Firebase is not configured.");
    const normalizedEmail = email.trim().toLowerCase(), normalizedName = username.trim();
    if (register && !usernamePattern.test(normalizedName)) return setError("Username must be 3–16 characters and may use letters, numbers, spaces, dots, hyphens, or underscores.");
    if (!emailPattern.test(normalizedEmail)) return setError("Enter a valid email address.");
    if (!password) return setError("Enter your password.");
    if (register && (password.length < 8 || password.length > 16 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password))) return setError("Password must be 8–16 characters with uppercase, lowercase, a number, and a symbol.");
    setBusy(true); setError("");
    try {
      if (register) { const credential = await createUserWithEmailAndPassword(firebaseAuth, normalizedEmail, password); await updateProfile(credential.user, { displayName: normalizedName }); }
      else await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, password);
      onClose();
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  }
  const switchMethod = (next: SignInMethod) => { setMethod(next); setError(""); if (next !== "phone") resetPhoneFlow(); };

  return <div className="auth-overlay"><section className="auth-modal" role="dialog" aria-modal="true" aria-label={method === "phone" ? "Sign in with mobile OTP" : register ? "Create your account" : "Sign in to Aaroda"}>
    <button className="auth-close" onClick={onClose} aria-label="Close sign in">×</button><span className="auth-mark">A</span><p className="eyebrow">SECURE ACCOUNT</p><h2>{method === "phone" ? "Sign in with mobile" : register ? "Create your account" : "Sign in to Aaroda"}</h2><p>{method === "phone" ? "Use your Indian mobile number. We will send a one-time password." : "Use Google or your email and password."}</p>
    <button className="google-signin" disabled={busy || !firebaseEnabled} onClick={google}><span className="google-g">G</span> Continue with Google</button>
    {PHONE_OTP_ENABLED && <div className="auth-methods" role="tablist"><button type="button" className={method === "phone" ? "active" : ""} onClick={() => switchMethod("phone")}>Mobile OTP</button><button type="button" className={method === "email" ? "active" : ""} onClick={() => switchMethod("email")}>Email</button></div>}
    {PHONE_OTP_ENABLED && method === "phone" ? (!confirmation ? <form onSubmit={sendOtp} noValidate>
      <div className="auth-name-grid"><div><label className="auth-label" htmlFor="auth-first-name">First name</label><input id="auth-first-name" className="auth-input" autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="First name" /></div><div><label className="auth-label" htmlFor="auth-last-name">Last name</label><input id="auth-last-name" className="auth-input" autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="Last name" /></div></div>
      <label className="auth-label" htmlFor="auth-phone">Mobile number</label><div className="phone-input"><span>+91</span><input id="auth-phone" type="tel" inputMode="numeric" autoComplete="tel-national" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(-10))} placeholder="98765 43210" /></div>
      <button className="auth-primary" disabled={busy || !firebaseEnabled}>{busy ? "Sending OTP…" : "Send OTP"}</button>
    </form> : <form onSubmit={verifyOtp} noValidate>
      <p className="otp-sent">OTP sent to +91 {cleanPhone}. Enter it below to continue.</p><label className="auth-label" htmlFor="auth-otp">One-time password</label><input id="auth-otp" className="auth-input auth-otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit OTP" autoFocus />
      <button className="auth-primary" disabled={busy}>{busy ? "Verifying OTP…" : "Verify & sign in"}</button><button type="button" className="auth-link" disabled={busy} onClick={resetPhoneFlow}>Use a different number</button>
    </form>) : <><div className="auth-divider"><span>or use email</span></div><form onSubmit={submit} noValidate>
      {register && <><label className="auth-label" htmlFor="auth-username">Username</label><input id="auth-username" className="auth-input" type="text" autoComplete="username" minLength={3} maxLength={16} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="3–16 characters" /></>}
      <label className="auth-label" htmlFor="auth-email">Email address</label><input id="auth-email" className="auth-input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
      <label className="auth-label" htmlFor="auth-password">Password</label><div className="auth-password-field"><input id="auth-password" className="auth-input" type={showPassword ? "text" : "password"} autoComplete={register ? "new-password" : "current-password"} minLength={8} maxLength={16} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={register ? "8–16 characters" : "Your password"} /><button type="button" className="auth-password-toggle" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} title={showPassword ? "Hide password" : "Show password"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.8" /></svg></button></div>
      {register && <small className="auth-password-help">Use uppercase, lowercase, a number, and a symbol.</small>}<button className="auth-primary" disabled={busy || !firebaseEnabled}>{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button>
    </form><button className="auth-link" onClick={() => { setRegister((current) => !current); setError(""); }}>{register ? "Already have an account? Sign in" : "New here? Create an account"}</button></>}
    {error && <div className="auth-error" role="alert">{error}</div>}<div id="firebase-phone-recaptcha" /><small>Accounts and sessions are securely managed by Firebase Authentication.</small>
  </section></div>;
}
