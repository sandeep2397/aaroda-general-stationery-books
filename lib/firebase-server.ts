export type FirebaseUser = { userId: string; email?: string; phoneNumber?: string };

export async function getFirebaseUser(request: Request): Promise<FirebaseUser | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!token || !apiKey) return null;
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: token }),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const payload = await response.json() as { users?: Array<{ localId?: string; email?: string; phoneNumber?: string }> };
  const user = payload.users?.[0];
  return user?.localId ? { userId: user.localId, email: user.email, phoneNumber: user.phoneNumber } : null;
}

export async function getFirebaseUserId(request: Request) {
  return (await getFirebaseUser(request))?.userId || null;
}
