export function appendPage<T extends { _id: string }>(existing: T[], incoming: T[]) {
  return Array.from(new Map([...existing, ...incoming].map((item) => [item._id, item])).values());
}
