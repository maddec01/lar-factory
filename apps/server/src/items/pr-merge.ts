import {
    activityUnavailable,
    mergeStageProblem,
    mergePrProblems,
    onAzure,
    sameRepo,
    type MergeConfirmation,
    type MergeMethod,
} from '@lar-factory/shared';
import { assertAzureWriteAllowed } from '@lar-factory/shared/azure-safety';
import type { WorkRecords } from '@lar-factory/work-records';
import { randomUUID } from 'node:crypto';

import type { BoardState } from '../board/board-state.ts';
import { prUrl } from '../config/pr-host.ts';
import { mergeProvider, type MergeProvider } from '../config/pr-merge.ts';
import type { Reply } from './item-commands.ts';
import { observePullRequest } from './observe-records.ts';

interface Dependencies {
    board: BoardState;
    records: WorkRecords | null;
    reread: () => void;
    busy?: (itemId: string) => string | null;
    provider?: (repo: string) => MergeProvider;
}

/** Server-owned confirmations and a PR-wide request guard shared by every board client. */
export function createPrMerge({ board, records, reread, busy, provider = mergeProvider }: Dependencies) {
    const confirmations = new Map<string, MergeConfirmation & { itemId: string; reference: string; expires: number }>();
    const running = new Set<string>();
    const reply = (status: number, body: object): Reply => ({ status, body: { ...body, board: board.snapshot() } });
    const resolve = (itemId: string) => {
        const item = board.find(itemId);

        if (!item || !records || item.recorded === false) throw new Error('This item has no recorded delivery PR.');

        if (activityUnavailable(board.snapshot(), Date.now()))
            throw new Error('Current build activity is unavailable. Refresh before merging.');

        const record = records.read(itemId);
        const reference = record.pullRequest;
        const split = reference?.lastIndexOf('#') ?? -1;
        const repo = reference?.slice(0, split) ?? '';
        const number = Number(reference?.slice(split + 1));
        const pr = item.linkedPrs[0];

        if (
            !reference ||
            !sameRepo(repo, record.repository) ||
            !sameRepo(repo, item.repo) ||
            !Number.isSafeInteger(number) ||
            number <= 0 ||
            pr?.number !== number ||
            pr.url.toLowerCase() !== prUrl(repo, number).toLowerCase()
        )
            throw new Error('The recorded delivery PR changed. Refresh the board.');

        if (
            record.status !== 'Ready to merge' ||
            record.setAside ||
            record.finishedAt ||
            record.needsYou ||
            record.needsYouCauses.length
        )
            throw new Error('The work is not Ready to merge.');

        const problem = mergeStageProblem(item) ?? busy?.(itemId);

        if (problem) throw new Error(problem);

        if (board.snapshot().itemSourceProblems?.some((p) => sameRepo(p.repo, repo)))
            throw new Error('The provider is disconnected. Refresh before merging.');

        return { item, repo, number, reference, key: reference.toLowerCase() };
    };
    const read = async (itemId: string) => {
        const resolved = resolve(itemId);
        const evidence = await provider(resolved.repo).read(resolved.repo, resolved.number);

        if (resolve(itemId).reference !== resolved.reference) throw new Error('The recorded delivery PR changed.');

        if (
            evidence.pr.number !== resolved.number ||
            evidence.pr.url.toLowerCase() !== resolved.item.linkedPrs[0]!.url.toLowerCase()
        )
            throw new Error('The provider returned a different PR.');

        return { ...resolved, evidence };
    };
    const observe = async (itemId: string, state: 'open' | 'closed' | 'merged') => {
        await observePullRequest(records!, itemId, async () => state);
        reread();
    };

    return {
        mergePending: (itemId: string) => {
            if (!records || board.find(itemId)?.recorded === false) return false;

            try {
                const reference = records.read(itemId).pullRequest;

                return !!reference && running.has(reference.toLowerCase());
            } catch {
                return false;
            }
        },
        async inspectMerge(this: void, itemId: string): Promise<Reply> {
            try {
                const { key } = resolve(itemId);

                if (running.has(key))
                    return reply(409, { error: 'A merge is pending. Wait for provider confirmation.' });

                const { evidence, reference } = await read(itemId);

                if (evidence.pr.state === 'merged') {
                    await observe(itemId, 'merged');

                    return reply(200, { merged: true, error: null });
                }

                const blockers = [...mergePrProblems(evidence.pr), ...evidence.blockers];

                if (!evidence.pr.sourceRevision || !evidence.methods.length)
                    blockers.push('Permitted merge methods or source revision are unavailable.');

                if (blockers.length) return reply(409, { error: blockers.join(' ') });

                // Bound memory and remove expired/cancelled confirmations without a timer.
                for (const [token, confirmation] of confirmations)
                    if (confirmation.expires < Date.now() || confirmation.itemId === itemId)
                        confirmations.delete(token);

                if (confirmations.size >= 500) confirmations.delete(confirmations.keys().next().value!);

                const confirmation: MergeConfirmation = {
                    token: randomUUID(),
                    number: evidence.pr.number,
                    url: evidence.pr.url,
                    sourceRevision: evidence.pr.sourceRevision!,
                    methods: [...evidence.methods],
                };

                confirmations.set(confirmation.token, {
                    ...confirmation,
                    reference,
                    itemId,
                    expires: Date.now() + 5 * 60_000,
                });

                return reply(200, { confirmation, error: null });
            } catch (error) {
                return reply(409, {
                    error: error instanceof Error ? error.message : 'Readiness unavailable. Open PR to continue.',
                });
            }
        },
        async mergePr(this: void, itemId: string, input: Record<string, unknown>): Promise<Reply> {
            let key: string | undefined;
            let submitted = false;

            try {
                const resolved = resolve(itemId);

                if (onAzure(resolved.repo)) assertAzureWriteAllowed();

                const confirmation = typeof input.token === 'string' ? confirmations.get(input.token) : undefined;

                if (
                    !confirmation ||
                    confirmation.itemId !== itemId ||
                    confirmation.reference !== resolved.reference ||
                    confirmation.expires < Date.now()
                )
                    return reply(409, { error: 'Inspect and confirm this delivery PR again.' });

                if (running.has(resolved.key))
                    return reply(409, { error: 'A merge is pending. Wait for provider confirmation.' });

                key = resolved.key;
                running.add(key);
                confirmations.delete(confirmation.token);

                const { evidence, repo, number, reference } = await read(itemId);

                if (evidence.pr.state === 'merged') {
                    await observe(itemId, 'merged');

                    return reply(200, { merged: true, error: null });
                }

                if (evidence.pr.sourceRevision !== confirmation.sourceRevision)
                    return reply(409, {
                        error: 'The PR source revision changed. Review and confirm the new revision.',
                    });

                const method = input.method as MergeMethod;
                const blockers = [...mergePrProblems(evidence.pr), ...evidence.blockers];

                if (!confirmation.methods.includes(method) || !evidence.methods.includes(method))
                    blockers.push('That merge method is no longer permitted.');

                if (blockers.length) return reply(409, { error: blockers.join(' ') });

                // Re-resolve immediately before mutation. Provider revision and policy guards remain authoritative.
                if (resolve(itemId).reference !== reference) throw new Error('The recorded delivery PR changed.');

                let failed = false;

                submitted = true;

                try {
                    await provider(repo).merge(repo, number, confirmation.sourceRevision, method);
                } catch {
                    failed = true;
                }

                // A lost response is never success. Reread before offering a new confirmation, even after errors.
                const after = await provider(repo).read(repo, number);

                if (
                    records!.read(itemId).pullRequest !== reference ||
                    after.pr.number !== number ||
                    after.pr.url !== confirmation.url
                )
                    throw new Error('The recorded delivery PR changed. Refresh before continuing.');

                await observe(itemId, after.pr.state);

                if (after.pr.state === 'merged') return reply(200, { merged: true, error: null });

                const remaining = [...mergePrProblems(after.pr), ...after.blockers].join(' ');

                return reply(409, {
                    error:
                        remaining ||
                        (failed
                            ? 'The provider did not confirm a merge. Open PR to check its policies or refresh readiness before trying again.'
                            : 'The provider has not confirmed the merge. Refresh readiness or Open PR to check its outcome.'),
                });
            } catch (error) {
                return reply(409, {
                    error: submitted
                        ? 'Merge outcome is unknown. Refresh readiness or Open PR before trying again.'
                        : error instanceof Error
                          ? error.message
                          : 'Merge readiness unavailable. Refresh readiness or Open PR to continue.',
                });
            } finally {
                if (key) running.delete(key);
            }
        },
    };
}
