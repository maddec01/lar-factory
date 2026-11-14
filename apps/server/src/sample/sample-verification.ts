import type { Item, LinkedPr } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';

import type { MergeProvider } from '../config/pr-merge.ts';
import type { createVerification } from '../items/verification.ts';

/** Explicit disposable Verify fixtures. They never represent real provider delivery and never call T3. */
export function sampleVerification(records: WorkRecords, tickets: () => Item[], refresh: () => void) {
    const prs = new Map<string, LinkedPr>();
    const messages: unknown[] = [];
    let headRead: Promise<void> | undefined;
    let releaseHeadRead: (() => void) | undefined;
    const provider: MergeProvider = {
        async read(repo, number) {
            if (!repo.startsWith('lar-factory-sample/')) throw new Error('Only fake sample PRs are supported.');

            const pr = prs.get(`${repo}#${number}`);

            if (!pr) throw new Error('No fake Verify fixture was selected.');

            await headRead;

            return { pr: structuredClone(pr), methods: ['squash'], blockers: [] };
        },
        async merge() {
            throw new Error('Fake Verify PRs cannot be merged.');
        },
    };
    const dependencies: Pick<Parameters<typeof createVerification>[0], 'provider' | 'send' | 'identity'> = {
        provider: () => provider,
        identity: () => 'Sample Pedro',
        send: async (command) => {
            messages.push(command);

            return { outcome: 'accepted', sequence: messages.length };
        },
    };

    return {
        dependencies,
        project(item: Item): Item {
            const pr = item.recorded === false ? undefined : prs.get(records.read(item.id).pullRequest ?? '');

            return pr ? { ...item, linkedPrs: [structuredClone(pr)] } : item;
        },
        async control(input: Record<string, unknown>) {
            let record = records.list({}).find((work) => prs.has(work.pullRequest ?? ''));

            if (input.change === 'seed') {
                if (!record) {
                    const ticket = tickets().find((item) => item.status === 'Verify');

                    if (!ticket) throw new Error('No fake Verify ticket is available.');

                    record = records.importTicket({
                        repository: ticket.repo,
                        title: ticket.title,
                        kind: 'bug',
                        ticket: `${ticket.repo}#${ticket.number}`,
                        status: 'Verify',
                    }).record;
                    record = records.setPullRequest(record.workId, record.revision, `${ticket.repo}#999`);
                    record = records.addThread(record.workId, record.revision, 'sample-verify-build', 'build');
                    prs.set(record.pullRequest!, {
                        number: 999,
                        url: `https://github.com/${record.repository}/pull/999`,
                        state: 'open',
                        isDraft: false,
                        sourceRevision: 'a'.repeat(40),
                        checks: null,
                        mergeState: 'can merge',
                        body: '## Test steps\n1. Open the fake greeting page.\n2. Press Say hello and check the greeting.\n3. Check the narrow layout.\n\n## Checks\nSample fixture only.',
                    });
                }
            } else {
                if (!record) throw new Error('Seed the fake Verify fixture first.');

                if (input.change === 'hold-head' || input.change === 'release-head') {
                    if (input.change === 'hold-head' && !headRead)
                        headRead = new Promise<void>((resolve) => {
                            releaseHeadRead = resolve;
                        });
                    else if (input.change === 'release-head') {
                        releaseHeadRead?.();
                        headRead = undefined;
                        releaseHeadRead = undefined;
                    }

                    return { workId: record.workId, messages };
                }

                if (input.change === 'head') {
                    if (typeof input.head !== 'string' || !/^[a-f0-9]{40}$/.test(input.head))
                        throw new Error('Use a full fake SHA.');

                    prs.get(record.pullRequest!)!.sourceRevision = input.head;
                } else if (input.change === 'ready')
                    record = records.update(record.workId, record.revision, { status: 'Verify' });
                else throw new Error('Choose seed, head, ready, hold-head or release-head.');
            }

            records.observeVerificationHead(
                record.workId,
                record.pullRequest!,
                prs.get(record.pullRequest!)!.sourceRevision!,
            );
            refresh();

            return { workId: record.workId, messages };
        },
    };
}
