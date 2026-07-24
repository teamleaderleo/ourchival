export type ConvexMutationResponse<T> = {
  status?: "success" | "error";
  errorMessage?: string;
  value?: T;
};

export type ArtifactMutationFailure = {
  ok: false;
  uploaded: false;
  reason: "request_failed";
  error: string;
  retryable: boolean;
};

export type ArtifactMutationResult<T> =
  | { ok: true; value: T }
  | ArtifactMutationFailure;

export async function callArtifactMutation<T>(
  endpoint: string,
  path: string,
  args: Record<string, unknown>,
): Promise<ArtifactMutationResult<T>> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, args, format: "json" }),
    });
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Artifact mutation request failed.",
      true,
    );
  }

  const body = (await response.json().catch(() => ({}))) as ConvexMutationResponse<T>;
  if (body.status === "error") {
    return failure(
      body.errorMessage || "Artifact mutation was rejected.",
      false,
    );
  }
  if (!response.ok) {
    return failure(
      body.errorMessage || response.statusText || "Artifact mutation failed.",
      isRetryableStatus(response.status),
    );
  }
  if (body.value === undefined) {
    return failure("Artifact mutation returned no result.", true);
  }
  return { ok: true, value: body.value };
}

export async function commitArtifactMutation<T>(
  endpoint: string,
  path: string,
  args: Record<string, unknown>,
): Promise<ArtifactMutationResult<T>> {
  const first = await callArtifactMutation<T>(endpoint, path, args);
  if (first.ok || !first.retryable) return first;
  const second = await callArtifactMutation<T>(endpoint, path, args);
  return second.ok ? second : first;
}

function failure(error: string, retryable: boolean): ArtifactMutationFailure {
  return {
    ok: false,
    uploaded: false,
    reason: "request_failed",
    error,
    retryable,
  };
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
