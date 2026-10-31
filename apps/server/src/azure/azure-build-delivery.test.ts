// Exercises the approver's Azure CLI command against a fake repository, never an organization.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { openWorkRecords } from '@lar-factory/work-records';
import { observePr } from '../config/pr-host.ts';
import { observePullRequest } from '../items/observe-records.ts';
import { AZURE_REPOS, prUrl } from './azure-repos.ts';
import { fakeAzRepos, type FakePr } from './fake-az.ts';

const REPO = 'contoso/Fabrikam%20Fiber/lar-api';
const BRANCH = 'feat/playback';
const description = 'Add playback.\n\nValidation: targeted checks passed.\nLiteral text: $(never-executed).';

// skills/lar-build/agents/approver.md supplies these CLI arguments after resolving the base branch.
const createArgs = (base: string) => ['repos', 'pr', 'create', '--repository', 'lar-api', '--source-branch', BRANCH,
  '--target-branch', base, '--title', 'feat: add playback', '--description', description,
  '--project', 'Fabrikam Fiber', '--organization', 'https://dev.azure.com/contoso'];

test('an Azure build creates a PR against the actual base, records it locally, and finishes only after an observed merge', async (t) => {
  const fake = fakeAzRepos({ defaultBranch: 'develop', branches: { [BRANCH]: 'build-head' } });
  const { branch: base } = await AZURE_REPOS.defaultBranchHead(REPO, fake.run);
  const created = JSON.parse(await fake.run(createArgs(base))) as FakePr;
  expect(created).toMatchObject({ pullRequestId: 100, sourceRefName: `refs/heads/${BRANCH}`, targetRefName: 'refs/heads/develop',
    title: 'feat: add playback', description, status: 'active' });

  const dir = mkdtempSync(join(tmpdir(), 'azure-build-delivery-'));
  const records = await openWorkRecords(join(dir, 'work-records.db'));
  t.onTestFinished(() => { records.close(); rmSync(dir, { recursive: true, force: true }); });
  let record = records.create({ title: 'Playback', repository: REPO, kind: 'build', status: 'Review' });
  record = records.setPullRequest(record.workId, record.revision, `${REPO}#${created.pullRequestId}`);
  expect(prUrl(REPO, created.pullRequestId)).toBe('https://dev.azure.com/contoso/Fabrikam%20Fiber/_git/lar-api/pullrequest/100');
  await observePullRequest(records, record.workId, () => observePr(REPO, created.pullRequestId, fake.run));
  expect(records.read(record.workId)).toMatchObject({ status: 'Review', finishedAt: null, pullRequest: `${REPO}#100` });

  fake.prs[0]!.status = 'completed'; // The user's merge arrives from the provider, outside the factory.
  await observePullRequest(records, record.workId, () => observePr(REPO, created.pullRequestId, fake.run));
  expect(records.read(record.workId)).toMatchObject({ status: 'Done', finishedAt: expect.any(String) });
  expect(fake.calls.filter(args => args.slice(0, 3).join(' ') === 'repos pr create')).toHaveLength(1);
  expect(fake.calls.some(args => args.includes('wit') || args.includes('--auto-complete'))).toBe(false);
  expect(fake.pushes).toEqual([]);
  expect(fake.comments).toEqual([]);
});

test('a lost PR-creation response is recovered by its source branch before recording or retrying', async () => {
  const fake = fakeAzRepos({ defaultBranch: 'release', branches: { [BRANCH]: 'build-head' } });
  const create = async () => { await fake.run(createArgs('release')); throw Error('Connection lost after creation'); };
  await expect(create()).rejects.toThrow('Connection lost');
  const found = JSON.parse(await fake.run(['repos', 'pr', 'list', '--repository', 'lar-api', '--source-branch', BRANCH,
    '--project', 'Fabrikam Fiber', '--organization', 'https://dev.azure.com/contoso'])) as FakePr[];
  expect(found).toHaveLength(1);
  expect(await observePr(REPO, found[0]!.pullRequestId, fake.run)).toBe('open');
  expect(fake.calls.filter(args => args.slice(0, 3).join(' ') === 'repos pr create')).toHaveLength(1);
});
