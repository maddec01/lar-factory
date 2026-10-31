import { expect, test } from 'vite-plus/test';
import { mapConcurrent } from './map-concurrent.ts';

test('bounded reads keep input order even when later requests finish first', async () => {
  const release = new Map<number, () => void>();
  const started: number[] = [];
  const results = mapConcurrent([0, 1, 2], async value => {
    started.push(value);
    await new Promise<void>(resolve => release.set(value, resolve));
    return `result ${value}`;
  }, 2);
  expect(started).toEqual([0, 1]);
  release.get(1)!();
  await Promise.resolve();
  await Promise.resolve();
  expect(started).toEqual([0, 1, 2]);
  release.get(2)!();
  release.get(0)!();
  expect(await results).toEqual(['result 0', 'result 1', 'result 2']);
});

test('failed reads reject the batch and an empty batch reads nothing', async () => {
  await expect(mapConcurrent([1, 2], async () => { throw Error('Read failed'); })).rejects.toThrow('Read failed');
  expect(await mapConcurrent([], async () => { throw Error('Unexpected read'); })).toEqual([]);
});
