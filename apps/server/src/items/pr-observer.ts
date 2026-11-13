// Follow unfinished delivery PRs at one shared cadence; fresh source reads supply progress without another call.
import { currentBuildThread, delegatedWorkRunning, sameRepo, type Item, type LinkedPr } from '@lar-factory/shared';
import type { PullRequestState, WorkRecord, WorkRecords } from '@lar-factory/work-records';

import { prUrl } from '../config/pr-host.ts';
import { observePullRequest } from './observe-records.ts';
import { createPrProgressReader } from './pr-progress.ts';

const PR_READ_MS = 15_000;
const IDLE_READ_MS = 5 * 60_000;

interface PrObserverOptions {
    repositories(): readonly string[];
    hidden(): ReadonlySet<string>;
    waits(repo: string): boolean;
    changed: () => void;
    currentItems?: () => readonly Item[];
    read?: (repo: string, number: number) => Promise<PullRequestState | LinkedPr>;
}

/** A low-cost PR pass independent of the five-minute ticket and dependency safety read. */
export function createPrObserver(records: WorkRecords, options: PrObserverOptions) {
    const readMany = createPrProgressReader();
    const progress = new Map<string, LinkedPr>();
    const checkedAt = new Map<string, number>();
    const stable = new Set<string>();
    const evidence = (pr: LinkedPr) =>
        JSON.stringify([
            pr.state,
            pr.isDraft,
            pr.mergeState,
            pr.sourceRevision,
            pr.checks,
            pr.pipelineUnread,
            pr.checkProgress?.state,
            pr.checkProgress?.coverage,
            pr.checkProgress?.prWideChecks,
        ]);
    const remember = (key: string, pr: LinkedPr) => {
        const previous = progress.get(key);

        if (previous && evidence(previous) === evidence(pr)) stable.add(key);
        else stable.delete(key);

        progress.set(key, pr);
    };
    let polling = false;
    const active = () => {
        const repos = options.repositories();
        const hidden = options.hidden();

        return records
            .list({})
            .filter(
                (record) =>
                    record.pullRequest &&
                    !record.finishedAt &&
                    !record.setAside &&
                    !hidden.has(record.workId) &&
                    repos.some((repo) => sameRepo(repo, record.repository)) &&
                    !options.waits(record.repository),
            );
    };
    const reference = (record: WorkRecord) => {
        const ref = record.pullRequest!;

        return { repo: ref.slice(0, ref.lastIndexOf('#')), number: Number(ref.slice(ref.lastIndexOf('#') + 1)) };
    };
    const apply = async (record: WorkRecord, state: () => Promise<PullRequestState | LinkedPr>) => {
        // Batched results belong to the PR selected when the poll started.
        if (records.read(record.workId).pullRequest !== record.pullRequest) return;

        await observePullRequest(records, record.workId, async () => {
            let next: PullRequestState | LinkedPr;

            try {
                next = await state();
            } catch (error) {
                const { repo, number } = reference(record);
                const url = prUrl(repo, number);
                const previous = progress.get(url.toLowerCase());

                remember(
                    url.toLowerCase(),
                    previous
                        ? {
                              ...previous,
                              checkProgress: {
                                  ...previous.checkProgress,
                                  state: previous.checkProgress?.state === 'unavailable' ? 'unavailable' : 'stale',
                              },
                          }
                        : {
                              number,
                              url,
                              state: 'open',
                              isDraft: false,
                              checks: null,
                              mergeState: 'checking',
                              pipelineUnread: true,
                              checkProgress: { state: 'unavailable' },
                          },
                );
                throw error;
            }

            if (typeof next !== 'string' && next.state === 'open' && next.sourceRevision)
                records.observeVerificationHead(record.workId, record.pullRequest!, next.sourceRevision);

            // A merge is terminal. An older in-flight read cannot reopen its observation.
            if (records.observations(record.workId).some((o) => o.of === 'pr' && o.state === 'merged')) return 'merged';

            if (typeof next === 'string') return next;

            // A replaced delivery PR cannot publish a late answer onto its replacement.
            if (records.read(record.workId).pullRequest === record.pullRequest) {
                const key = next.url.toLowerCase();
                const previous = progress.get(key);

                remember(
                    key,
                    next.checkProgress?.state === 'unavailable' &&
                        previous?.checkProgress &&
                        previous.checkProgress.state !== 'unavailable' &&
                        previous.sourceRevision === next.sourceRevision
                        ? {
                              ...next,
                              checks: previous.checks,
                              checkProgress: { ...previous.checkProgress, state: 'stale' },
                          }
                        : next,
                );
            }

            return next.state;
        });
        options.changed();
    };

    return {
        project(items: Item[]): Item[] {
            return items.map((item) => ({
                ...item,
                linkedPrs: item.linkedPrs.map((pr) => {
                    let observed = progress.get(pr.url.toLowerCase());
                    const observation =
                        item.recorded !== false && records.observations(item.id).find((o) => o.of === 'pr');
                    const failed = observation && observation.failure;

                    // Merge commands confirm completion directly. Finished records are no longer polled.
                    if (observation && observation.state === 'merged') {
                        const record = records.read(item.id);
                        const { repo, number } = reference(record);

                        if (pr.url.toLowerCase() === prUrl(repo, number).toLowerCase()) {
                            observed = { ...(observed ?? pr), state: 'merged' };
                            progress.set(pr.url.toLowerCase(), observed);
                        }
                    }

                    if (!observed)
                        return failed
                            ? {
                                  ...pr,
                                  checkProgress: {
                                      ...pr.checkProgress,
                                      state: pr.pipelineUnread ? 'unavailable' : 'stale',
                                  },
                              }
                            : pr;

                    const { checks, mergeState, sourceRevision, state, isDraft } = observed;

                    return {
                        ...pr,
                        checks,
                        mergeState,
                        sourceRevision,
                        state,
                        isDraft,
                        pipelineUnread: observed.pipelineUnread,
                        checkProgress: {
                            ...observed.checkProgress,
                            state: failed ? 'stale' : (observed.checkProgress?.state ?? 'unavailable'),
                        },
                    };
                }),
            }));
        },
        async known(items: readonly Item[], now = Date.now()): Promise<void> {
            const states = new Map(
                items.flatMap((item) => item.linkedPrs.map((pr) => [pr.url.toLowerCase(), pr] as const)),
            );

            for (const record of active()) {
                const { repo, number } = reference(record);
                const pr = states.get(prUrl(repo, number).toLowerCase());

                if (!pr || pr.pipelineUnread) continue;

                const previousProgress = progress.get(pr.url.toLowerCase());

                if (previousProgress) {
                    const changedHead = pr.sourceRevision && previousProgress.sourceRevision !== pr.sourceRevision;

                    if (changedHead) stable.delete(pr.url.toLowerCase());

                    progress.set(
                        pr.url.toLowerCase(),
                        changedHead
                            ? { ...pr, checkProgress: { state: 'unavailable' } }
                            : { ...previousProgress, state: pr.state, isDraft: pr.isDraft, mergeState: pr.mergeState },
                    );
                }

                if (pr.checkProgress?.state === 'current') {
                    progress.set(pr.url.toLowerCase(), pr);
                    checkedAt.set(record.pullRequest!.toLowerCase(), now);
                }

                if (pr.state === 'open' && pr.sourceRevision)
                    records.observeVerificationHead(record.workId, record.pullRequest!, pr.sourceRevision);

                const previous = records.observations(record.workId).find((observation) => observation.of === 'pr');

                if (previous?.state === pr.state && !previous.failure) continue;

                await apply(record, async () => pr.state);
            }
        },
        async poll(now = Date.now()): Promise<void> {
            if (polling) return;

            polling = true;

            try {
                const working = new Set(
                    (options.currentItems?.() ?? [])
                        .filter((item) => currentBuildThread(item)?.currentRunning || delegatedWorkRunning(item))
                        .map((item) => item.id),
                );
                const due = active().filter((record) => {
                    const { repo, number } = reference(record);
                    const url = prUrl(repo, number).toLowerCase();
                    const pr = progress.get(url);
                    const busy =
                        working.has(record.workId) ||
                        ((!pr || pr.checkProgress?.state !== 'current' || pr.mergeState === 'checking') &&
                            !stable.has(url)) ||
                        !!pr?.checks?.running ||
                        !!pr?.checkProgress?.prWideChecks?.running;

                    return (
                        now - (checkedAt.get(record.pullRequest!.toLowerCase()) ?? -Infinity) >=
                        (busy ? PR_READ_MS : IDLE_READ_MS)
                    );
                });

                for (const record of due) checkedAt.set(record.pullRequest!.toLowerCase(), now);

                const refs = [
                    ...new Map(due.map((record) => [record.pullRequest!.toLowerCase(), reference(record)])).values(),
                ];
                const reads = options.read
                    ? new Map(
                          await Promise.all(
                              refs.map(
                                  async ({ repo, number }) =>
                                      [
                                          `${repo}#${number}`.toLowerCase(),
                                          (await Promise.allSettled([options.read!(repo, number)]))[0]!,
                                      ] as const,
                              ),
                          ),
                      )
                    : await readMany(refs);

                for (const record of due) {
                    await apply(record, async () => {
                        const result = reads.get(record.pullRequest!.toLowerCase())!;

                        if (result.status === 'rejected') throw result.reason;

                        return result.value;
                    });
                }
            } finally {
                polling = false;
            }
        },
    };
}
