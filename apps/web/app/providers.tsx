"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useMemo } from "react";

export const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();

export function Providers({ children }: { children: ReactNode }) {
  const client = useMemo(() => (convexUrl ? new ConvexReactClient(convexUrl) : null), []);

  if (!client) {
    // Without a Convex URL the reactive hooks can't run; render children so the
    // app can show a setup notice instead of crashing.
    return <>{children}</>;
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
