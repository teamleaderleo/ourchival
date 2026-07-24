export function captureSessionMutationActive(
  disabledBatchActions: boolean[],
) {
  return (
    disabledBatchActions.length > 0 &&
    disabledBatchActions.every(Boolean)
  );
}
