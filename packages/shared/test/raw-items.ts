// Raw issues as GitHub returns them, so the step that attaches slices runs.

import { statusLabel, type Status, type RawItem } from '@lar-factory/shared';

export const rawIssue = (id: string, number: number, status: string, labels: string[], extra: Partial<NonNullable<RawItem['content']>> = {}): RawItem => ({
  id, updatedAt: '2026-10-21T08:00:00Z',
  content: { __typename: 'Issue', id: `I_${number}`, number, title: `Issue ${number}`, url: `https://github.com/maddec01/lar-factory/issues/${number}`,
    state: 'OPEN', updatedAt: '2026-10-21T08:00:00Z', repository: { nameWithOwner: 'maddec01/lar-factory' },
    labels: { nodes: [...labels, ...(status && status !== 'Done' ? [statusLabel(status as Exclude<Status, 'Done'>)] : [])].map((name) => ({ name })) }, ...extra },
});

export const sliceRef = (number: number, state: 'OPEN' | 'CLOSED') => ({ number, title: `Issue ${number}`,
  url: `https://github.com/maddec01/lar-factory/issues/${number}`, state, repository: { nameWithOwner: 'maddec01/lar-factory' } });

/** An issue with node id I_<number>, as the server tests’ fake gh returns it. */
export const boardIssue = (number: number, status: string, repo = 'maddec01/lar-factory', labels: string[] = []): RawItem =>
  rawIssue(`I_${number}`, number, status, labels, { url: `https://github.com/${repo}/issues/${number}`, repository: { nameWithOwner: repo } });
