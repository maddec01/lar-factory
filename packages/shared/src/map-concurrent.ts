// Bound independent reads while preserving their input order.
export async function mapConcurrent<T, R>(values: readonly T[], read: (value: T, index: number) => Promise<R>, concurrency = 6): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await read(values[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(values.length, Math.max(1, Math.trunc(concurrency))) }, worker));
  return results;
}
