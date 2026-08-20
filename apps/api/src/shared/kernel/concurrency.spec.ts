import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    const result = await mapWithConcurrency([30, 10, 20], 3, async (ms, i) => {
      await sleep(ms);
      return i;
    });
    expect(result).toEqual([0, 1, 2]);
  });

  it('never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(5);
      inFlight -= 1;
      return null;
    });

    expect(peak).toBe(3);
  });

  it('handles an empty list and a limit larger than the input', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 99, async (n) => n * 2)).toEqual([2, 4]);
  });

  it('propagates a rejection', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('turn failed');
        return n;
      }),
    ).rejects.toThrow('turn failed');
  });
});
