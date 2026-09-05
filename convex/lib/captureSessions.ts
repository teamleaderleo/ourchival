export function captureSessionCompletedAt(
  status: "running" | "completed" | "interrupted",
  completedAt: number | undefined,
) {
  return status === "completed" ? completedAt : undefined;
}
