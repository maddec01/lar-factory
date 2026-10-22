import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/** Every `owner/repo#n` the data names, with each distinct way it is named (issue or PR, and title). */
function refUses(data: unknown): Map<string, Set<string>> {
  const uses = new Map<string, Set<string>>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    const match = typeof node.url === 'string' ? /github\.com\/([^/]+\/[^/]+)\/(issues|pull)\/(\d+)/.exec(node.url) : null;
    if (match) {
      const [, repo = '', kind = '', number = ''] = match;
      const key = `${repo.toLowerCase()}#${number}`;
      const set = uses.get(key) ?? uses.set(key, new Set()).get(key)!;
      set.add(kind);
      if (typeof node.title === 'string') set.add(`title: ${node.title}`);
    }
    Object.values(node).forEach(visit);
  };
  visit(data);
  return uses;
}

/** Issues and PRs share one number space per repo, so one number names one thing. */
function clashes(data: unknown): string[] {
  return [...refUses(data)].filter(([, set]) => set.has('issues') && set.has('pull')
    || [...set].filter((use) => use.startsWith('title: ')).length > 1).map(([key]) => key);
}

test('the clash check catches one number naming two things', () => {
  const url = (kind: string, n: number) => `https://github.com/o/r/${kind}/${n}`;
  assert.deepEqual(clashes([{ url: url('issues', 1), title: 'A' }, { url: url('issues', 1), title: 'B' }]), ['o/r#1']);
  assert.deepEqual(clashes([{ url: url('issues', 2), title: 'A' }, { url: url('pull', 2) }]), ['o/r#2']);
  assert.deepEqual(clashes([{ url: url('issues', 3), title: 'A' }, { url: url('issues', 3), title: 'A' }]), []);
});

test('sample data never gives one issue or PR number to two things', async () => {
  const data = JSON.parse(await readFile(new URL('./sample.json', import.meta.url), 'utf8'));
  assert.deepEqual(clashes(data), []);
});
