// Raw project items as GitHub returns them, so the step that attaches slices runs.

import type { RawItem } from '@mux-factory/shared';

export const rawIssue = (id: string, number: number, status: string, labels: string[], extra: Partial<NonNullable<RawItem['content']>> = {}): RawItem => ({
  id, updatedAt: '2026-10-21T08:00:00Z', status: { name: status },
  content: { __typename: 'Issue', number, title: `Issue ${number}`, url: `https://github.com/maddec01/mux-factory/issues/${number}`,
    state: 'OPEN', updatedAt: '2026-10-21T08:00:00Z', repository: { nameWithOwner: 'maddec01/mux-factory' },
    labels: { nodes: labels.map((name) => ({ name })) }, ...extra },
});

export const sliceRef = (number: number, state: 'OPEN' | 'CLOSED') => ({ number, title: `Issue ${number}`,
  url: `https://github.com/maddec01/mux-factory/issues/${number}`, state, repository: { nameWithOwner: 'maddec01/mux-factory' } });

/** A project issue with the id `PVTI_<number>`, as the server tests' fake gh returns it. */
export const projectIssue = (number: number, status: string, repo = 'maddec01/mux-factory', labels: string[] = []): RawItem =>
  rawIssue(`PVTI_${number}`, number, status, labels, { url: `https://github.com/${repo}/issues/${number}`, repository: { nameWithOwner: repo } });
