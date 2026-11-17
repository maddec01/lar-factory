import type { LinkedPr } from '@lar-factory/shared';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { PrLoopState } from './pr-loop.ts';

const exec = promisify(execFile);
const gh = async (args: string[]) => (await exec('gh', args, { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })).stdout;
const graphql = async <T>(query: string, vars: Record<string, string | number | null>, run: typeof gh): Promise<T> => {
    const args = ['api', 'graphql', '-f', `query=${query}`];

    for (const [key, value] of Object.entries(vars))
        if (value !== null) args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);

    return JSON.parse(await run(args)) as T;
};

export interface PrEvent {
    id: string;
    url: string;
    author: string;
    at: string;
    body: string;
    state: string;
    head?: string;
}
export interface PrLoopRead {
    head: string;
    base: string;
    events: PrEvent[];
    repliedTo?: string[];
    required: 'green' | 'pending' | 'failed' | 'unknown';
    failures: string[];
    unresolvedThreads?: number;
    reviewDecision?: string;
}
interface Comment {
    id: number;
    html_url: string;
    user: { type: string; login: string } | null;
    body: string;
    submitted_at?: string;
    created_at: string;
    updated_at?: string;
    state?: string;
    commit_id?: string;
    in_reply_to_id?: number;
}
interface Context {
    id: string;
    isRequired: boolean;
    name?: string;
    context?: string;
    status?: string;
    conclusion?: string;
    state?: string;
    detailsUrl?: string;
    targetUrl?: string;
}
interface Connection<T> {
    nodes: T[];
    pageInfo: { hasNextPage: boolean; endCursor: string };
}
interface ReviewThread {
    id: string;
    isResolved: boolean;
    isOutdated: boolean;
    comments: Connection<{ databaseId: number }>;
}
interface Evidence {
    reviewDecision?: string;
    state: string;
    isDraft: boolean;
    headRefOid: string;
    baseRefOid: string;
    baseRefName: string;
    baseRef: { branchProtectionRule: { requiredStatusCheckContexts: string[] } | null };
    statusCheckRollup: { contexts: { nodes: Context[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } | null;
}

const query = `query($owner:String!, $name:String!, $number:Int!, $cursor:String) {
    repository(owner:$owner,name:$name) { pullRequest(number:$number) {
        state isDraft headRefOid baseRefOid baseRefName reviewDecision
        baseRef { branchProtectionRule { requiredStatusCheckContexts } }
        statusCheckRollup { contexts(first:100,after:$cursor) { pageInfo { hasNextPage endCursor } nodes {
            ... on CheckRun { id name status conclusion detailsUrl isRequired(pullRequestNumber:$number) }
            ... on StatusContext { id context state targetUrl isRequired(pullRequestNumber:$number) }
        } } }
    } }
}`;

/** Current unresolved feedback, actual write permission and revision-bound required checks. */
export async function readGithubPrLoop(
    repo: string,
    number: number,
    pr: LinkedPr,
    previous: PrLoopState,
    run: (args: string[]) => Promise<string> = gh,
): Promise<PrLoopRead> {
    const [owner, name] = repo.split('/');
    const read = async (cursor: string | null = null) => {
        const result = await graphql<{ data: { repository: { pullRequest: Evidence } }; errors?: unknown[] }>(
            query,
            { owner: owner!, name: name!, number, cursor },
            run,
        );

        if (result.errors?.length || !result.data?.repository?.pullRequest)
            throw new Error('PR review evidence unavailable.');

        return result.data.repository.pullRequest;
    };
    const pages = async (path: string): Promise<Comment[]> => {
        const result: unknown = JSON.parse(await run(['api', '--paginate', '--slurp', `${path}?per_page=100`]));

        if (!Array.isArray(result) || result.some((page) => !Array.isArray(page)))
            throw new Error('PR feedback unavailable.');

        return result.flat() as Comment[];
    };
    let unresolvedThreads = 0;
    const readInline = async (): Promise<Comment[]> => {
        const unresolved = new Set<number>();
        let cursor: string | null = null;

        do {
            const result: {
                data: { repository: { pullRequest: { reviewThreads: Connection<ReviewThread> } } };
                errors?: unknown[];
            } = await graphql(
                `
                    query ($owner: String!, $name: String!, $number: Int!, $cursor: String) {
                        repository(owner: $owner, name: $name) {
                            pullRequest(number: $number) {
                                reviewThreads(first: 100, after: $cursor) {
                                    pageInfo {
                                        hasNextPage
                                        endCursor
                                    }
                                    nodes {
                                        id
                                        isResolved
                                        isOutdated
                                        comments(first: 100) {
                                            pageInfo {
                                                hasNextPage
                                                endCursor
                                            }
                                            nodes {
                                                databaseId
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `,
                { owner: owner!, name: name!, number, cursor },
                run,
            );
            const threads = result.data?.repository?.pullRequest?.reviewThreads;

            if (result.errors?.length || !threads) throw Error('PR review threads unavailable.');

            for (const thread of threads.nodes) {
                if (typeof thread.isResolved !== 'boolean') throw Error('PR thread resolution unavailable.');

                if (thread.isResolved) continue;

                let page = thread.comments;
                const ids: number[] = [];
                let resolved = false;

                for (;;) {
                    for (const comment of page.nodes) ids.push(comment.databaseId);

                    if (!page.pageInfo.hasNextPage) break;

                    const more: { data: { node: ReviewThread }; errors?: unknown[] } = await graphql(
                        `
                            query ($id: ID!, $cursor: String!) {
                                node(id: $id) {
                                    ... on PullRequestReviewThread {
                                        isResolved
                                        comments(first: 100, after: $cursor) {
                                            pageInfo {
                                                hasNextPage
                                                endCursor
                                            }
                                            nodes {
                                                databaseId
                                            }
                                        }
                                    }
                                }
                            }
                        `,
                        { id: thread.id, cursor: page.pageInfo.endCursor },
                        run,
                    );

                    if (more.errors?.length || !more.data?.node?.comments)
                        throw Error('PR thread comments unavailable.');

                    if (more.data.node.isResolved) {
                        resolved = true;
                        break;
                    }

                    page = more.data.node.comments;
                }

                if (!resolved) {
                    unresolvedThreads++;
                    for (const id of ids) unresolved.add(id);
                }
            }
            cursor = threads.pageInfo.hasNextPage ? threads.pageInfo.endCursor : null;
        } while (cursor);

        // REST supplies all comment bodies and identities; GraphQL supplies resolution and membership.
        return (await pages(`repos/${repo}/pulls/${number}/comments`)).filter((comment) => unresolved.has(comment.id));
    };
    const results = await Promise.allSettled([
        read(),
        pages(`repos/${repo}/pulls/${number}/reviews`),
        readInline(),
        pages(`repos/${repo}/issues/${number}/comments`),
    ]);

    for (const result of results) if (result.status === 'rejected') throw result.reason;

    const [first, reviews, inline, comments] = results.map(
        (result) => (result as PromiseFulfilledResult<unknown>).value,
    ) as [Evidence, Comment[], Comment[], Comment[]];

    if (
        first.state !== 'OPEN' ||
        first.isDraft ||
        (pr.sourceRevision && first.headRefOid !== pr.sourceRevision) ||
        !/^[a-f0-9]{40,64}$/.test(first.baseRefOid)
    )
        throw new Error('PR changed during review observation.');

    const contexts = [...(first.statusCheckRollup?.contexts.nodes ?? [])];
    let page = first;

    while (page.statusCheckRollup?.contexts.pageInfo.hasNextPage) {
        page = await read(page.statusCheckRollup.contexts.pageInfo.endCursor);

        if (page.headRefOid !== first.headRefOid || page.baseRefOid !== first.baseRefOid)
            throw new Error('PR changed while reading checks.');

        contexts.push(...(page.statusCheckRollup?.contexts.nodes ?? []));
    }

    const permissions = new Map<string, boolean>();
    const events: PrEvent[] = [];

    for (const [kind, entries] of [
        ['review', reviews],
        ['inline', inline],
        ['comment', comments],
    ] as const) {
        for (const entry of entries) {
            const user = entry.user;

            if (previous.agentComments.includes(entry.html_url)) continue;

            if (user?.type !== 'User' || !user.login || entry.state === 'PENDING') continue;

            if (!permissions.has(user.login)) {
                try {
                    const permission = JSON.parse(
                        await run(['api', `repos/${repo}/collaborators/${encodeURIComponent(user.login)}/permission`]),
                    );

                    permissions.set(user.login, ['write', 'maintain', 'admin'].includes(permission.permission));
                } catch {
                    throw new Error('PR author permissions unavailable.');
                }
            }

            if (!permissions.get(user.login)) continue;

            const at = entry.updated_at ?? entry.submitted_at ?? entry.created_at;

            if (!Number.isFinite(Date.parse(at)) || typeof entry.body !== 'string' || !Number.isSafeInteger(entry.id))
                throw new Error('PR feedback is incomplete.');

            events.push({
                id: `${kind}:${entry.id}`,
                url: entry.html_url,
                author: user.login,
                at,
                body: entry.body,
                state: entry.state ?? 'COMMENTED',
                head: entry.commit_id,
            });
        }
    }

    let required: PrLoopRead['required'] = 'unknown';
    const failures: string[] = [];

    try {
        const rules: { type: string; parameters?: { required_status_checks?: { context: string }[] } }[][] = JSON.parse(
            await run([
                'api',
                '--paginate',
                '--slurp',
                `repos/${repo}/rules/branches/${encodeURIComponent(first.baseRefName)}?per_page=100`,
            ]),
        );

        if (!Array.isArray(rules) || rules.some((r) => !Array.isArray(r)) || first.baseRef === undefined)
            throw new Error('Unknown rules');

        if (
            rules
                .flat()
                .some(
                    (r) =>
                        !r ||
                        typeof r.type !== 'string' ||
                        r.type === 'workflows' ||
                        (r.type === 'required_status_checks' && !Array.isArray(r.parameters?.required_status_checks)),
                )
        )
            throw new Error('Unknown required-check policy');

        const names = new Set([
            ...(first.baseRef.branchProtectionRule?.requiredStatusCheckContexts ?? []),
            ...rules
                .flat()
                .filter((r) => r.type === 'required_status_checks')
                .flatMap((r) => r.parameters?.required_status_checks?.map((c) => c.context) ?? []),
        ]);
        const checks = contexts.filter((c) => c.isRequired);

        if (contexts.some((c) => typeof c.isRequired !== 'boolean')) throw new Error('Unknown check requirement');

        const missing = [...names].some((n) => !checks.some((c) => (c.name ?? c.context) === n));

        if (
            checks.some((c) =>
                c.status
                    ? !['QUEUED', 'IN_PROGRESS', 'WAITING', 'PENDING', 'REQUESTED', 'COMPLETED'].includes(c.status) ||
                      (c.status === 'COMPLETED' && !c.conclusion)
                    : !['SUCCESS', 'FAILURE', 'ERROR', 'PENDING', 'EXPECTED'].includes(c.state ?? ''),
            )
        )
            throw new Error('Unknown check state');

        const pending = checks.some((c) =>
            c.status ? c.status !== 'COMPLETED' : ['PENDING', 'EXPECTED'].includes(c.state ?? ''),
        );

        for (const check of checks) {
            if (
                (check.status === 'COMPLETED' && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(check.conclusion ?? '')) ||
                ['FAILURE', 'ERROR'].includes(check.state ?? '')
            )
                failures.push(
                    `${check.id}: ${check.name ?? check.context} ${check.detailsUrl ?? check.targetUrl ?? ''}`,
                );
        }
        required = failures.length ? 'failed' : pending || missing ? 'pending' : 'green';
    } catch {
        /* A policy read failure is unknown, never an empty required-check set. */
    }

    const final = await read();

    if (
        final.state !== 'OPEN' ||
        final.isDraft !== pr.isDraft ||
        final.headRefOid !== first.headRefOid ||
        final.baseRefOid !== first.baseRefOid
    )
        throw new Error('PR changed during review observation.');

    return {
        head: first.headRefOid,
        base: first.baseRefOid,
        events: events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id)),
        repliedTo: inline
            .filter(
                (comment) =>
                    previous.agentComments.includes(comment.html_url) && Number.isSafeInteger(comment.in_reply_to_id),
            )
            .map((comment) => `inline:${comment.in_reply_to_id}`),
        required,
        failures,
        unresolvedThreads,
        reviewDecision: final.reviewDecision,
    };
}
