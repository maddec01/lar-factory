import { isRecord } from '@lar-factory/shared';

import type { Reply } from '../items/item-commands.ts';
import { FAKE_OPERATIONS, type FakeFailure, type FakeOperation } from './fake-failures.ts';
import type { createFakeTracker } from './fake-tracker.ts';

/** Guarded by the same Host, Origin, JSON size and app-secret checks as all other board writes. */
export function sampleControls(tracker: ReturnType<typeof createFakeTracker>, refresh: () => Promise<void>) {
    return async (input: Record<string, unknown>): Promise<Reply> => {
        try {
            if (input.action === 'failure') {
                if (!FAKE_OPERATIONS.includes(input.operation as FakeOperation))
                    throw Error('Choose a named sample operation.');

                const { rule } = input;

                if (
                    rule !== null &&
                    (!isRecord(rule) ||
                        Object.keys(rule).some((key) => !['fail', 'message', 'latencyMs'].includes(key)) ||
                        (rule.message !== undefined && (typeof rule.message !== 'string' || rule.message.length > 500)))
                )
                    throw Error('Send a sample failure rule or null.');

                tracker.failures.set(input.operation as FakeOperation, rule as FakeFailure | null);
            } else if (input.action === 'clear-failures') tracker.failures.clear();
            else if (input.action === 'link') {
                const reference = (value: unknown) => {
                    if (
                        !isRecord(value) ||
                        typeof value.repo !== 'string' ||
                        !Number.isSafeInteger(value.number) ||
                        Number(value.number) < 1
                    )
                        throw Error('Name a fake repository and positive ticket number.');

                    return { repo: value.repo, number: value.number as number };
                };
                const from = reference(input.from);

                if (input.kind === 'parent')
                    await tracker.setParent(from, input.to === null ? null : reference(input.to));
                else if (input.kind === 'related' || input.kind === 'blocked-by') {
                    if (input.present !== undefined && typeof input.present !== 'boolean')
                        throw Error('Use a boolean for present.');

                    await tracker.setLink(from, reference(input.to), input.kind, input.present as boolean | undefined);
                } else throw Error('Choose parent, related or blocked-by.');

                await refresh();
            } else throw Error('Choose failure, clear-failures or link.');

            return { status: 200, body: { error: null } };
        } catch (error) {
            return { status: 400, body: { error: (error as Error).message } };
        }
    };
}
