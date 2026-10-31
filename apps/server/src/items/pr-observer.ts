// Follow only unfinished work's PRs. GitHub reuses ETags, and source reads supply state without another call.
import { onAzure, sameRepo, type Item } from '@lar-factory/shared';
import type { PullRequestState, WorkRecord, WorkRecords } from '@lar-factory/work-records';
import { observePr, prUrl } from '../config/pr-host.ts';
import { getIfChanged } from '../github/github.ts';
import { observePullRequest } from './observe-records.ts';

const PR_READ_MS = 15_000;

/** Conditional GitHub state reads; Azure uses its native read-only PR lookup. */
export function conditionalPrReader(run?: (args: string[]) => Promise<string>) {
  const previous = new Map<string, { etag?: string; state: PullRequestState }>();
  return async (repo: string, number: number): Promise<PullRequestState> => {
    if (onAzure(repo)) return observePr(repo, number, run);
    const key = `${repo.toLowerCase()}#${number}`;
    const last = previous.get(key);
    const answer = await getIfChanged<{ state: string; merged_at: string | null }>(`repos/${repo}/pulls/${number}`, last?.etag, run);
    if (!answer) {
      if (!last) throw Error('GitHub returned no PR state.');
      return last.state;
    }
    if (!['open', 'closed'].includes(answer.body.state) || !(answer.body.merged_at === null || typeof answer.body.merged_at === 'string')) throw Error('GitHub returned an invalid PR state.');
    const state = answer.body.merged_at ? 'merged' : answer.body.state as 'open' | 'closed';
    previous.set(key, { etag: answer.etag, state });
    return state;
  };
}

interface PrObserverOptions {
  repositories(): readonly string[];
  hidden(): ReadonlySet<string>;
  waits(repo: string): boolean;
  changed(): void;
  read?(repo: string, number: number): Promise<PullRequestState>;
}

/** A low-cost PR pass independent of the five-minute ticket and dependency safety read. */
export function createPrObserver(records: WorkRecords, options: PrObserverOptions) {
  const read = options.read ?? conditionalPrReader();
  const checkedAt = new Map<string, number>();
  let polling = false;
  const active = () => {
    const repos = options.repositories();
    const hidden = options.hidden();
    return records.list({}).filter(record => record.pullRequest && !record.finishedAt && !record.setAside && !hidden.has(record.workId)
      && repos.some(repo => sameRepo(repo, record.repository)) && !options.waits(record.repository));
  };
  const reference = (record: WorkRecord) => {
    const ref = record.pullRequest!;
    return { repo: ref.slice(0, ref.lastIndexOf('#')), number: Number(ref.slice(ref.lastIndexOf('#') + 1)) };
  };
  const apply = async (record: WorkRecord, state: () => Promise<PullRequestState>) => {
    await observePullRequest(records, record.workId, state);
    options.changed();
  };
  return {
    async known(items: readonly Item[], now = Date.now()): Promise<void> {
      const states = new Map(items.flatMap(item => item.linkedPrs.map(pr => [pr.url.toLowerCase(), pr.state] as const)));
      for (const record of active()) {
        const { repo, number } = reference(record);
        const state = states.get(prUrl(repo, number).toLowerCase());
        if (state === undefined) continue;
        checkedAt.set(record.pullRequest!.toLowerCase(), now);
        const previous = records.observations(record.workId).find(observation => observation.of === 'pr');
        if (previous?.state === state && !previous.failure) continue;
        await apply(record, async () => state);
      }
    },
    async poll(now = Date.now()): Promise<void> {
      if (polling) return;
      polling = true;
      try {
        const due = active().filter(record => now - (checkedAt.get(record.pullRequest!.toLowerCase()) ?? -Infinity) >= PR_READ_MS);
        const reads = new Map<string, Promise<PullRequestState>>();
        let cursor = 0;
        const worker = async () => {
          while (cursor < due.length) {
            const record = due[cursor++]!;
            const key = record.pullRequest!.toLowerCase();
            if (!reads.has(key)) {
              checkedAt.set(key, now);
              const { repo, number } = reference(record);
              reads.set(key, Promise.resolve().then(() => read(repo, number)));
            }
            await apply(record, () => reads.get(key)!);
          }
        };
        await Promise.all(Array.from({ length: Math.min(6, due.length) }, worker));
      } finally { polling = false; }
    },
  };
}
