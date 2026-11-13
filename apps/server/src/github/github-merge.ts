import { type LinkedPr, type MergeMethod } from '@lar-factory/shared';

import type { MergeProvider } from '../config/pr-merge.ts';
import { gh, graphql } from './github.ts';

interface MergePr {
    id: string;
    number: number;
    url: string;
    state: string;
    isDraft: boolean;
    headRefOid: string;
    body?: string;
    baseRefName: string;
    mergeStateStatus: string;
    isMergeQueueEnabled: boolean;
    reviewDecision: string | null;
    baseRef: { branchProtectionRule: { requiresLinearHistory: boolean } | null };
    statusCheckRollup: { state: string } | null;
}
interface Repository {
    viewerPermission: string;
    mergeCommitAllowed: boolean;
    squashMergeAllowed: boolean;
    rebaseMergeAllowed: boolean;
    pullRequest: MergePr;
}
interface Rule {
    type: string;
    parameters?: { allowed_merge_methods?: string[] };
}

/** https://docs.github.com/en/graphql/reference/pulls#mergepullrequestinput
 * https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch */
export function githubMerge(run: (args: string[]) => Promise<string> = gh): MergeProvider {
    return {
        async read(repo, number) {
            const [owner, name] = repo.split('/');
            const result = await graphql<{ data: { repository: Repository } }>(
                `
                    query ($owner: String!, $name: String!, $number: Int!) {
                        repository(owner: $owner, name: $name) {
                            viewerPermission
                            mergeCommitAllowed
                            squashMergeAllowed
                            rebaseMergeAllowed
                            pullRequest(number: $number) {
                                id
                                number
                                url
                                state
                                isDraft
                                headRefOid
                                body
                                baseRefName
                                mergeStateStatus
                                isMergeQueueEnabled
                                reviewDecision
                                baseRef {
                                    branchProtectionRule {
                                        requiresLinearHistory
                                    }
                                }
                                statusCheckRollup {
                                    state
                                }
                            }
                        }
                    }
                `,
                { owner: owner!, name: name!, number },
                run,
            );
            const repository = result.data?.repository;
            const pr = repository?.pullRequest;

            if (
                !pr ||
                pr.number !== number ||
                !pr.id ||
                !pr.headRefOid ||
                !pr.baseRefName ||
                !pr.baseRef ||
                (pr.baseRef.branchProtectionRule !== null &&
                    typeof pr.baseRef.branchProtectionRule?.requiresLinearHistory !== 'boolean') ||
                pr.statusCheckRollup === undefined ||
                (pr.reviewDecision !== null && typeof pr.reviewDecision !== 'string') ||
                typeof pr.isDraft !== 'boolean' ||
                typeof pr.isMergeQueueEnabled !== 'boolean' ||
                !['OPEN', 'CLOSED', 'MERGED'].includes(pr.state)
            )
                throw new Error('GitHub merge readiness is unavailable. Open PR to continue.');

            const blockers: string[] = [];

            if (!['WRITE', 'MAINTAIN', 'ADMIN'].includes(repository.viewerPermission))
                blockers.push('Your GitHub login has no merge permission.');

            if (pr.isMergeQueueEnabled)
                blockers.push('This project requires a merge queue. Open PR to continue at GitHub.');

            if (pr.reviewDecision && pr.reviewDecision !== 'APPROVED')
                blockers.push('Required reviews are not approved.');

            if (pr.mergeStateStatus !== 'CLEAN')
                blockers.push(
                    pr.mergeStateStatus === 'DIRTY'
                        ? 'Resolve conflicts before merging.'
                        : 'GitHub readiness is blocked or unknown. Check reviews, checks and policies.',
                );

            if (pr.statusCheckRollup && pr.statusCheckRollup.state !== 'SUCCESS')
                blockers.push('Checks are running, failed or unknown.');

            // Read effective branch rules, including inherited organization rules and permitted methods.
            const pages: Rule[][] = JSON.parse(
                await run([
                    'api',
                    '--paginate',
                    '--slurp',
                    `repos/${repo}/rules/branches/${encodeURIComponent(pr.baseRefName)}?per_page=100`,
                ]),
            );

            if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page)))
                throw new Error('GitHub branch policies are unavailable.');

            const rules = pages.flat();

            if (!Array.isArray(rules) || rules.some((r) => !r || typeof r.type !== 'string'))
                throw new Error('GitHub branch policies are unavailable.');

            if (rules.some((r) => r.type === 'merge_queue'))
                blockers.push('This project requires a merge queue. Open PR to continue at GitHub.');

            let methods: MergeMethod[] = [];

            for (const [method, allowed] of [
                ['merge', repository.mergeCommitAllowed],
                ['squash', repository.squashMergeAllowed],
                ['rebase', repository.rebaseMergeAllowed],
            ] as const) {
                if (typeof allowed !== 'boolean') throw new Error('GitHub merge method policy is unavailable.');

                if (allowed) methods.push(method);
            }
            for (const rule of rules.filter((r) => r.type === 'pull_request')) {
                const allowed = rule.parameters?.allowed_merge_methods;

                if (allowed !== undefined) {
                    if (!Array.isArray(allowed) || allowed.some((m) => !['merge', 'squash', 'rebase'].includes(m)))
                        throw new Error('GitHub merge method policy is unknown.');

                    methods = methods.filter((m) => allowed.includes(m));
                }
            }

            if (
                pr.baseRef?.branchProtectionRule?.requiresLinearHistory ||
                rules.some((r) => r.type === 'required_linear_history')
            )
                methods = methods.filter((m) => m !== 'merge');

            const linked: LinkedPr = {
                number,
                url: pr.url,
                sourceRevision: pr.headRefOid,
                body: pr.body,
                state: pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : 'open',
                isDraft: pr.isDraft,
                checks: null,
                mergeState:
                    pr.mergeStateStatus === 'CLEAN'
                        ? 'can merge'
                        : pr.mergeStateStatus === 'DIRTY'
                          ? 'conflicts'
                          : 'blocked',
            };

            return { pr: linked, methods, blockers };
        },
        async merge(repo, number, revision, method) {
            // Resolve the node from the server's repository/number. Never accept a client-supplied node ID.
            const [owner, name] = repo.split('/');
            const { data } = await graphql<{ data: { repository: { pullRequest: { id: string } } } }>(
                `
                    query ($owner: String!, $name: String!, $number: Int!) {
                        repository(owner: $owner, name: $name) {
                            pullRequest(number: $number) {
                                id
                            }
                        }
                    }
                `,
                { owner: owner!, name: name!, number },
                run,
            );

            if (!data?.repository?.pullRequest?.id) throw new Error('GitHub PR identity is unavailable.');

            await graphql(
                `
                    mutation ($id: ID!, $head: GitObjectID!, $method: PullRequestMergeMethod!) {
                        mergePullRequest(input: { pullRequestId: $id, expectedHeadOid: $head, mergeMethod: $method }) {
                            pullRequest {
                                merged
                            }
                        }
                    }
                `,
                { id: data.repository.pullRequest.id, head: revision, method: method.toUpperCase() },
                run,
            );
        },
    };
}
