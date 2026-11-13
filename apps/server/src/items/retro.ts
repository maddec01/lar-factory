import type { WorkRecords } from '@lar-factory/work-records';
import { captureWork, createRecordTicket, type TicketCaptureDeps } from '@lar-factory/work-records/create-ticket';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';

import type { BoardState } from '../board/board-state.ts';
import { sendThreadCommand } from '../t3/thread-commands.ts';
import type { Reply } from './item-commands.ts';

interface Dependencies {
    board: BoardState;
    records: WorkRecords | null;
    reread: () => void;
    send?: typeof sendThreadCommand;
    identity?: () => string;
    capture?: Pick<TicketCaptureDeps, 'provider' | 'labels' | 'discoverOptions'>;
}

/** Merge wakes the same build once. Choices and capture receipts survive restarts and lost responses. */
export function createRetro({
    board,
    records,
    reread,
    send = sendThreadCommand,
    identity = () => userInfo().username,
    capture,
}: Dependencies) {
    const pending = new Set<string>();
    const run = async (id: string, action: () => Promise<void>): Promise<Reply> => {
        if (pending.has(id)) return { status: 409, body: { error: 'A retro action is pending.' } };

        pending.add(id);

        try {
            if (!records || !board.find(id)) throw new Error('This build is unavailable.');

            await action();
            reread();

            return { status: 200, body: { error: null, board: board.snapshot() } };
        } catch (error) {
            reread();

            return { status: 409, body: { error: (error as Error).message, board: board.snapshot() } };
        } finally {
            pending.delete(id);
        }
    };
    const start = async (id: string, retry = false) => {
        const retro = records!.prepareRetro(id);

        if (!retro || retro.delivery.sent) return;

        if (retry && retro.delivery.error) {
            // Rejected commands are permanent; an unconfirmed delivery retains its original IDs.
            retro.delivery.error = null;
        }

        const delivery = retro.delivery;
        const result = await send({
            type: 'message.dispatch',
            createdBy: 'user',
            creationSource: 'web',
            commandId: delivery.commandId,
            threadId: delivery.threadId,
            messageId: delivery.messageId,
            attachments: [],
            dispatchMode: { type: 'queue_after_active' },
            text: `The delivery PR ${retro.pr} is confirmed merged and work ${id} is Done. Run the builder's Retro now, once. Keep Done. Record all proposed follow-ups with lar-work propose-retro ${id} --revision N --file F (JSON array of {title,description,repository,kind}, kind bug/feature/improvement). Use [] if none. The board collects and records Pedro's choice and captures selected follow-ups; do not ask for picks in chat or create them yourself.`,
        });
        // The agent may have proposed suggestions while dispatch was in flight.
        const current = records!.retro(id)!;

        current.delivery.sent = current.suggestions !== null || result.outcome === 'accepted';
        current.delivery.error = current.delivery.sent ? null : result.outcome === 'accepted' ? null : result.reason;

        if (result.outcome === 'rejected') {
            current.delivery.commandId = randomUUID();
            current.delivery.messageId = randomUUID();
        }

        records!.saveRetro(id, current);
    };
    const captureChosen = async (id: string) => {
        const retro = records!.retro(id);

        if (!retro?.choice || !retro.suggestions) return;

        for (const index of retro.choice.selected) {
            const suggestion = retro.suggestions[index]!;
            const receipt = retro.captures[index]!;

            if (receipt.complete) continue;

            try {
                if (!board.snapshot().repos.some((repo) => repo.repo === suggestion.repository))
                    throw new Error(`Onboard ${suggestion.repository} before creating this follow-up.`);

                const local = await captureWork(
                    {
                        requestId: receipt.requestId,
                        draft: {
                            title: suggestion.title,
                            repo: suggestion.repository,
                            kind: suggestion.kind,
                            description: suggestion.description,
                            createIssue: false,
                        },
                    },
                    { records: records!, repos: () => board.snapshot().repos, ...capture },
                );

                if (!local.body.record) throw new Error(local.body.error ?? 'Follow-up capture failed.');

                const made = local.body.record;

                receipt.workId = made.workId;
                records!.saveRetro(id, retro);

                if (!made.ticket) {
                    const result = await createRecordTicket(
                        made.workId,
                        { revision: made.revision, requestId: receipt.ticketRequestId, retro: true },
                        {
                            records: records!,
                            repos: () => board.snapshot().repos,
                            ...capture,
                        },
                    );

                    if (result.body.error) throw new Error(result.body.error);
                }

                receipt.error = null;
                receipt.complete = true;
            } catch (error) {
                receipt.error = (error as Error).message;
            }

            records!.saveRetro(id, retro);
        }
    };

    return {
        reconcileRetros: async () => {
            for (const item of board.snapshot().items) {
                if (
                    !records ||
                    item.recorded === false ||
                    item.status !== 'Done' ||
                    item.buildPhase !== 'checks' ||
                    pending.has(item.id)
                )
                    continue;

                if (!records.observations(item.id).some((o) => o.of === 'pr' && o.state === 'merged')) continue;

                if (!records.threads(item.id).some((thread) => thread.purpose === 'build' && !thread.deletedAt))
                    continue;

                const retro = records.retro(item.id);

                if (retro?.delivery.sent || retro?.delivery.error) continue;

                await run(item.id, () => start(item.id));
            }
        },
        chooseRetro: (id: string, input: Record<string, unknown>) =>
            run(id, async () => {
                records!.chooseRetro(id, input.revision as number, input.selected as number[], identity());
                reread();
                await captureChosen(id);
            }),
        retryRetro: (id: string) =>
            run(id, async () => {
                if (!records!.retro(id)) throw new Error('No retro is available to retry.');

                await start(id, true);
                await captureChosen(id);
            }),
    };
}
