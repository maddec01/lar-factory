import type { WorkRecords } from '@lar-factory/work-records';
import { refreshSpecs, syncSpecs } from '@lar-factory/work-records/spec-sync';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';

import type { BoardState } from '../board/board-state.ts';
import { sendThreadCommand } from '../t3/thread-commands.ts';
import type { Reply } from './item-commands.ts';

interface Dependencies {
    board: BoardState;
    records: WorkRecords | null;
    reread: () => void;
    refresh?: (id: string) => Promise<unknown>;
    sync?: () => Promise<unknown>;
    identity?: () => string;
    send?: typeof sendThreadCommand;
}

/** Only the board's displayed, one-use request can approve; client identity and evidence are ignored. */
export function createBriefApproval({
    board,
    records,
    reread,
    refresh = (id) => refreshSpecs(records!, { workId: id }),
    sync = () => syncSpecs(records!),
    identity = () => userInfo().username,
    send = sendThreadCommand,
}: Dependencies) {
    const requests = new Map<string, { at: number; manifest: ReturnType<WorkRecords['gateBatch']> }>();
    const run = async (action: () => Promise<object>): Promise<Reply> => {
        try {
            if (!records) throw new Error('Work records are unavailable.');

            return { status: 200, body: { ...(await action()), board: board.snapshot(), error: null } };
        } catch (error) {
            return { status: 409, body: { error: (error as Error).message, board: board.snapshot() } };
        }
    };
    const current = (ids: string[]) => {
        for (const id of ids) {
            const record = records!.read(id);

            if (
                !board.find(id) ||
                record.finishedAt ||
                record.setAside ||
                ['concept', 'decision', 'slice'].includes(record.kind) ||
                records!.children(id).some((r) => r.kind !== 'slice')
            )
                throw new Error('Only an unfinished brief on this board can be approved.');
        }
    };

    const sending = new Set<string>();
    const reconcileBriefApprovals = async () => {
        for (const delivery of records?.pendingGateResumes() ?? []) {
            if (sending.has(delivery.commandId)) continue;

            const owner = records!.read(delivery.workId);

            if (
                owner.setAside ||
                records!.threads(owner.workId).find((t) => t.threadId === delivery.threadId)?.deletedAt
            )
                continue;

            sending.add(delivery.commandId);

            try {
                const answer = await send({
                    type: 'message.dispatch',
                    createdBy: 'user',
                    creationSource: 'web',
                    commandId: delivery.commandId,
                    messageId: delivery.messageId,
                    threadId: delivery.threadId,
                    attachments: [],
                    dispatchMode: { type: 'queue_after_active' },
                    text: `The board approved brief batch ${delivery.digest} for work ${owner.workId}. Read the recorded gates; continue this same owner and reconcile the group. Approval is recorded; do not ask Pedro to approve it in chat or start another owner.`,
                });

                records!.gateResumeResult(
                    delivery.commandId,
                    answer.outcome,
                    answer.outcome === 'accepted' ? undefined : answer.reason,
                );

                const current = records!.read(owner.workId);

                if (
                    answer.outcome === 'accepted' &&
                    current.status === 'Needs you' &&
                    current.needsYouCauses.length === 0 &&
                    /approve.*brief|brief.*approval/i.test(current.needsYou ?? '')
                )
                    records!.resumeFromUser(
                        current.workId,
                        current.revision,
                        current.buildBranch || current.buildPhase ? 'In progress' : 'Shaping',
                    );
            } finally {
                sending.delete(delivery.commandId);
            }
        }
        reread();
    };

    return {
        reconcileBriefApprovals,
        inspectBrief: (id: string, input: Record<string, unknown>) =>
            run(async () => {
                const ids = input.workIds === undefined ? [id] : input.workIds;

                if (
                    !Array.isArray(ids) ||
                    !ids.length ||
                    ids.some((value) => typeof value !== 'string') ||
                    !ids.includes(id)
                )
                    throw new Error('Name every brief to display.');

                current(ids);
                for (const member of ids) await refresh(member);
                current(ids);

                const manifest = records!.gateBatch(ids);
                const requestId = randomUUID();

                for (const [key, request] of requests) if (Date.now() - request.at > 600000) requests.delete(key);
                requests.set(requestId, { at: Date.now(), manifest });

                return {
                    approval: {
                        requestId,
                        digest: manifest.digest,
                        briefs: manifest.members.map(({ display }) => ({
                            ...display,
                            title: records!.read(display.workId).title,
                        })),
                    },
                };
            }),
        approveBrief: (id: string, input: Record<string, unknown>) =>
            run(async () => {
                const request = typeof input.requestId === 'string' ? requests.get(input.requestId) : undefined;

                if (
                    !request ||
                    Date.now() - request.at > 600000 ||
                    request.manifest.digest !== input.digest ||
                    !request.manifest.members.some(({ display }) => display.workId === id)
                )
                    throw new Error('Display the exact brief and digest in the board before approving.');

                requests.delete(String(input.requestId));

                const ids = request.manifest.members.map(({ display }) => display.workId);

                current(ids);
                for (const member of ids) await refresh(member);
                current(ids);

                const approval = records!.recordGateBatch(
                    request.manifest,
                    request.manifest.digest,
                    identity(),
                    `Board Approve brief action ${String(input.requestId)}`,
                );

                for (const member of ids) {
                    const record = records!.read(member);

                    if (
                        record.status === 'Needs you' &&
                        record.needsYouCauses.length === 0 &&
                        /approve.*brief|brief.*approval/i.test(record.needsYou ?? '')
                    ) {
                        const active = !!(record.buildBranch || record.buildPhase || record.pullRequest);

                        records!.resumeFromUser(member, record.revision, active ? 'In progress' : 'Ready');
                    }
                }
                reread();
                await sync();
                await reconcileBriefApprovals();
                reread();

                return { approval };
            }),
    };
}
