import { readFile } from "node:fs/promises";

export const dynamic = "force-dynamic";

// Opt-in desktop bootstrap. Hosted vaults keep their existing authentication.
export async function GET(request: Request) {
  const origin = process.env.OURCHIVAL_LOCAL_ORIGIN;
  const keyFile = process.env.OURCHIVAL_LOCAL_OWNER_KEY_FILE;
  const headers = { "Cache-Control": "no-store", "Vary": "Origin, Sec-Fetch-Site" };
  if (!origin || !keyFile) return new Response(null, { status: 404, headers });
  const configured = new URL(origin);
  if (configured.protocol !== "http:" || configured.hostname !== "127.0.0.1") {
    return new Response(null, { status: 404, headers });
  }
  if (
    request.headers.get("host") !== configured.host ||
    request.headers.get("sec-fetch-site") !== "same-origin" ||
    (request.headers.has("origin") && request.headers.get("origin") !== configured.origin)
  ) return new Response(null, { status: 403, headers });

  try {
    const credential = (await readFile(keyFile, "utf8")).trim();
    if (!credential) throw new Error("Missing local credential");
    return Response.json({ credential }, { headers });
  } catch {
    return Response.json({ local: true }, { status: 503, headers });
  }
}
