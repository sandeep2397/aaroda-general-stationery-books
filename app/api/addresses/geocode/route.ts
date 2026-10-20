import { applyRateLimit } from "@/lib/rate-limiter";

export async function GET(request: Request) {
  const limited = applyRateLimit(request, "standard"); if (limited) return limited;
  const { searchParams } = new URL(request.url); const query = searchParams.get("q")?.trim(); const lat = searchParams.get("lat"); const lon = searchParams.get("lon");
  if (!query && !(lat && lon)) return Response.json({ error: "Provide an address or coordinates." }, { status: 400 });
  try {
    const url = query ? `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(query)}` : `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(lat!)}&lon=${encodeURIComponent(lon!)}`;
    const response = await fetch(url, { headers: { "User-Agent": "AarodaStore/1.0 contact@aaroda.local", "Accept-Language": "en" }, next: { revalidate: 0 } });
    if (!response.ok) return Response.json({ error: "Location service is currently unavailable." }, { status: 502 });
    const data = await response.json(); const values = Array.isArray(data) ? data : [data];
    return Response.json({ results: values.map((item: Record<string, unknown>) => ({ displayName: item.display_name, lat: item.lat, lon: item.lon, address: item.address || {} })) });
  } catch { return Response.json({ error: "Location lookup failed. You can enter the address manually." }, { status: 502 }); }
}
