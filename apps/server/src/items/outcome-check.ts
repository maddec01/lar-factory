import type { WorkRecords } from '@lar-factory/work-records';

import type { BoardState } from '../board/board-state.ts';
import { sendThreadCommand } from '../t3/thread-commands.ts';
import type { Reply } from './item-commands.ts';
import { finishCompleted } from './observe-records.ts';

/** Dispatch survives board restarts and uncertain T3 responses without creating a second owner. */
export function createOutcomeCheck({
    board,
    records,
    reread,
    send = sendThreadCommand,
}: {
    board: BoardState;
    records: WorkRecords | null;
    reread: () => void;
    send?: typeof sendThreadCommand;
}) {
    const sending = new Set<string>();

    return {
        async reconcileOutcomeChecks() {
            if (!records) return;

            for (const item of board.snapshot().items) {
                if (
                    item.recorded === false ||
                    item.setAside ||
                    item.parentId ||
                    !item.releasePlan ||
                    item.releasePlan.outcomeCheck.result !== 'pending' ||
                    sending.has(item.id)
                )
                    continue;

                sending.add(item.id);

                try {
                    const { ready, run } = records.prepareOutcomeCheck(item.id);

                    if (!ready || !run || run.sent || run.rejected) continue;

                    const result = await send({
                        type: 'message.dispatch',
                        createdBy: 'user',
                        creationSource: 'web',
                        commandId: run.commandId,
                        messageId: run.messageId,
                        threadId: run.threadId,
                        attachments: [],
                        dispatchMode: { type: 'queue_after_active' },
                        text: `All active parts of group ${item.id} are Done and every release step is complete. Run its final Outcome check now, once, as this group's owner. Read lar-work release-plan ${item.id}, children, completion and the current map/answers. Browser checks use T3 browser preview only; serve local static output with a local static HTTP server on a free port, then stop it. Never launch another browser or import tools from other checkouts. Check the actual merged revisions together, using the recorded Outcome criterion: ${item.releasePlan.outcomeCheck.what}\nRecord the measured evidence, commands/results and exact merged SHAs with lar-work record-outcome-check ${item.id} --revision N --input-digest ${run.digest} --result passed|failed --identity "Outcome owner" --evidence "observed evidence". Read the current parent revision first. Do not infer success from merges alone. If the check needs Pedro, record failed with the reason; the board offers him the Outcome action. Gates, Verify, release steps, Outcome and merges use board controls. End the turn; never duplicate their recorded waits with a generic Needs you notice or a T3 question. Reconcile affected projections after the check. The board derives Done from passing evidence.`,
                    });

                    records.outcomeCheckDelivered(
                        item.id,
                        run.commandId,
                        result.outcome,
                        result.outcome === 'accepted' ? undefined : result.reason,
                    );
                } catch (error) {
                    const run = records.outcomeCheck(item.id).run;

                    if (run)
                        records.outcomeCheckDelivered(item.id, run.commandId, 'unconfirmed', (error as Error).message);
                } finally {
                    sending.delete(item.id);
                }
            }
            finishCompleted(
                records,
                board.snapshot().repos.map((repo) => repo.repo),
            );
            reread();
        },
        async proposeOutcomeFix(this: void, id: string, input: Record<string, unknown>): Promise<Reply> {
            try {
                if (!records || !board.find(id) || typeof input.inputDigest !== 'string')
                    throw Error('Read the failed Outcome first.');

                const proposal = records.prepareOutcomeFix(id, input.revision as number, input.inputDigest);

                if (proposal.rejected) throw Error(proposal.error ?? 'T3 refused the fix proposal.');

                if (!proposal.sent) {
                    const plan = records.releasePlan(id)!;
                    const result = await send({
                        type: 'message.dispatch',
                        createdBy: 'user',
                        creationSource: 'web',
                        commandId: proposal.commandId,
                        messageId: proposal.messageId,
                        threadId: proposal.threadId,
                        attachments: [],
                        dispatchMode: { type: 'queue_after_active' },
                        text: `Pedro requested a fix proposal for group ${id}. Outcome failed: ${plan.outcomeCheck.what}\nEvidence: ${plan.outcomeCheck.evidence?.evidence}\nRead the parent, children, current map and release plan. Preserve the failed evidence. Propose the smallest fix part using normal lar-work create-parts; reconcile briefs, blockers, map and release order. Amend the release plan to include the fix merged revision and fresh activation before a new Outcome check; preserve prior failed evidence in history. Run Doubt and present a batch gate for Pedro to approve on the board, then stop. Do not rebuild completed parts, retry Outcome, record a replacement pass or start any new build before its gate.`,
                    });

                    records.outcomeFixDelivered(
                        id,
                        proposal.commandId,
                        result.outcome,
                        result.outcome === 'accepted' ? undefined : result.reason,
                    );

                    if (result.outcome !== 'accepted') throw Error(result.reason);
                }

                reread();

                return { status: 200, body: { error: null, board: board.snapshot() } };
            } catch (error) {
                reread();

                return { status: 409, body: { error: (error as Error).message, board: board.snapshot() } };
            }
        },
        async recordOutcomeCheck(this: void, id: string, input: Record<string, unknown>): Promise<Reply> {
            try {
                if (!records || !board.find(id)) throw new Error('This group is unavailable.');

                const current = records.outcomeCheck(id);

                if (!current.ready || input.inputDigest !== current.digest)
                    throw new Error('Read the current delivered composition before recording its Outcome.');

                if (input.result !== 'passed' && input.result !== 'failed') throw new Error('Choose passed or failed.');

                if (typeof input.evidence !== 'string' || !input.evidence.trim() || input.evidence.length > 1000)
                    throw new Error('Add short Outcome evidence (up to 1000 characters).');

                records.recordOutcomeCheck(
                    id,
                    input.revision as number,
                    input.result,
                    'Pedro',
                    input.evidence,
                    current.digest,
                );
                finishCompleted(
                    records,
                    board.snapshot().repos.map((repo) => repo.repo),
                );
                reread();

                return { status: 200, body: { error: null, board: board.snapshot() } };
            } catch (error) {
                return { status: 409, body: { error: (error as Error).message, board: board.snapshot() } };
            }
        },
    };
}
