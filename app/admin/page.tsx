"use client";
import { useEffect, useState } from "react";
import { User, onIdTokenChanged } from "firebase/auth";
import AdminDashboard from "@/components/AdminDashboard";
import AuthModal from "@/components/AuthModal";
import { firebaseAuth } from "@/lib/firebase";
import { isAdminEmail } from "@/lib/admin";
export default function AdminPage(){const [user,setUser]=useState<User|null>(null),[open,setOpen]=useState(false);useEffect(()=>firebaseAuth?onIdTokenChanged(firebaseAuth,setUser):undefined,[]);if(!user)return <main className="access-page"><h1>Admin access</h1><p>Sign in with an authorised Aaroda account to manage inventory.</p><button className="auth-primary" onClick={()=>setOpen(true)}>Sign in</button>{open&&<AuthModal onClose={()=>setOpen(false)}/>}</main>;if(!isAdminEmail(user.email))return <main className="access-page"><h1>Access denied</h1><p>{user.email} is not an authorised inventory administrator.</p></main>;return <AdminDashboard userId={user.uid} onSwitchToStore={()=>location.assign("/")}/>}
