import type { Item } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';

/** Derive the notice after T3 observations, so a live item thread always holds it back. */
export function deletedThreadNotice(records: WorkRecords, item: Item): Item['needsYou'] {
  const record = records.read(item.id);
  if (record.kind === 'slice' || !['Shaping', 'Needs you', 'In progress', 'Review'].includes(record.status)
    || !Array.isArray(item.threads) || item.threads.some(t => t.state === 'running' || t.state === 'needs you' || t.hasLiveChildren)) return item.needsYou;
  const latest = records.threads(item.id).filter(t => t.purpose === 'shape' || t.purpose === 'build').at(-1);
  if (!latest?.deletedAt) return item.needsYou;
  const pr = records.observations(item.id).find(o => o.of === 'pr')?.state;
  if (pr === 'closed' && record.needsYou) return item.needsYou;
  return { reason: 'The latest work thread was deleted.', deletedThread: true, deletedThreadPurpose: latest.purpose === 'build' ? 'build' : 'shape',
    offers: pr === 'open' ? ['start-again'] : ['start-again', 'back-to-queue', 'back-to-list'] };
}
