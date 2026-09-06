/** Storage metadata may expose the SHA-256 digest as hex or base64. */
export function storageSha256(value: string): string {
  if (/^[a-f0-9]{64}$/.test(value)) return value;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw new Error("Invalid storage digest");
  const bytes = atob(value);
  if (bytes.length !== 32 || btoa(bytes) !== value)
    throw new Error("Invalid storage digest");
  return Array.from(bytes, (c) =>
    c.charCodeAt(0).toString(16).padStart(2, "0"),
  ).join("");
}
