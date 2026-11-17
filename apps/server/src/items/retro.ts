import type { WorkRecords } from '@lar-factory/work-records';
import { captureWork, createRecordTicket, type TicketCaptureDeps } from '@lar-factory/work-records/create-ticket';
import { userInfo } from 'node:os';

import type { BoardState } from '../board/board-state.ts';
import type { Reply } from './item-commands.ts';

interface Dependencies {
    board: BoardState;
    records: WorkRecords | null;
    reread: () => void;
    identity?: () => string;
    capture?: Pick<TicketCaptureDeps, 'provider' | 'labels' | 'discoverOptions'>;
}

/** The board records the pick before merge and creates the chosen follow-ups at once; a failed capture is only reported. */
export function createRetro({ board, records, reread, identity = () => userInfo().username, capture }: Dependencies) {
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
    const captureChosen = async (id: string) => {
        const retro = records!.retro(id);

        if (!retro?.choice || !retro.suggestions) return;

        const failed: string[] = [];

        for (const index of retro.choice.selected) {
            const suggestion = retro.suggestions[index]!;
            const receipt = retro.captures[index]!;

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

                receipt.complete = true;
                records!.saveRetro(id, retro);
            } catch (error) {
                failed.push(`Could not create follow-up "${suggestion.title}": ${(error as Error).message}`);
            }
        }

        if (failed.length) throw new Error(failed.join(' '));
    };

    return {
        chooseRetro: (id: string, input: Record<string, unknown>) =>
            run(id, async () => {
                records!.chooseRetro(id, input.revision as number, input.selected as number[], identity());
                reread();
                await captureChosen(id);
            }),
    };
}
