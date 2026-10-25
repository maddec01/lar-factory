// Raw project items as GitHub returns them, so the step that attaches slices runs.

import type { RawItem } from '@lar-factory/shared';

export const rawIssue = (id: string, number: number, status: string, labels: string[], extra: Partial<NonNullable<RawItem['content']>> = {}): RawItem => ({
  id, updatedAt: '2026-10-21T08:00:00Z', status: { name: status },
  content: { __typename: 'Issue', number, title: `Issue ${number}`, url: `https://github.com/maddec01/lar-factory/issues/${number}`,
    state: 'OPEN', updatedAt: '2026-10-21T08:00:00Z', repository: { nameWithOwner: 'maddec01/lar-factory' },
    labels: { nodes: labels.map((name) => ({ name })) }, ...extra },
});

export const sliceRef = (number: number, state: 'OPEN' | 'CLOSED') => ({ number, title: `Issue ${number}`,
  url: `https://github.com/maddec01/lar-factory/issues/${number}`, state, repository: { nameWithOwner: 'maddec01/lar-factory' } });

/** A project issue with the id `PVTI_<number>`, as the server tests' fake gh returns it. */
export const projectIssue = (number: number, status: string, repo = 'maddec01/lar-factory', labels: string[] = []): RawItem =>
  rawIssue(`PVTI_${number}`, number, status, labels, { url: `https://github.com/${repo}/issues/${number}`, repository: { nameWithOwner: repo } });
