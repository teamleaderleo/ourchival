export function importReceipt(value?: string) {
  try {
    const r = JSON.parse(value ?? "null");
    if (!r || r.version !== 2) return null;
    const count = (key: string): number | null => Number.isSafeInteger(r[key]) && r[key] >= 0 ? r[key] : null;
    return {
      observed: count("observedArtworks"), originals: count("originalsStored"),
      expected: count("imagePagesExpected"), remaining: count("unresolved"),
      unknown: count("unknownPageCountArtworks"), degraded: count("degradedPreviews"),
      unproven: count("unprovenRenditions"), linked: count("originalsLinked"),
    };
  } catch { return null; }
}
