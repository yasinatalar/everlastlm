/**
 * Runs an async mapper over `items` with at most `limit` in flight, preserving
 * input order in the result.
 *
 * Replaces `p-limit`, which is ESM-only. The compiled output here is CommonJS,
 * so `require('p-limit')` throws `ERR_REQUIRE_ESM` at runtime — invisible
 * locally, because Node 22.12+ permits `require()` of an ESM module, and fatal
 * on a platform whose runtime does not. A dozen lines is a better trade than a
 * dependency that fails only after deploy.
 */
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]!, index);
    }
  };

  // One rejection fails the whole batch, matching how the callers treat it:
  // a dialogue with a missing turn is not worth publishing.
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );

  return results;
};
