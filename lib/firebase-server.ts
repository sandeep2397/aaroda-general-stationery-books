export async function getFirebaseUserId(request: Request) {
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
  const payload = await response.json() as { users?: Array<{ localId?: string }> };
  return payload.users?.[0]?.localId || null;
}
