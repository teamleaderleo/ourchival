export async function retryOnce<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (firstError) {
    try {
      return await operation();
    } catch {
      throw firstError;
    }
  }
}
