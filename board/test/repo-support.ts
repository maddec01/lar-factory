import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

/** Real, isolated Git histories; no network or user Git configuration. */
export async function factoryRepo(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'mux update test '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, 'factory');
  const origin = join(dir, 'origin.git');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  await mkdir(repo);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  for (const folder of ['src', 'scripts', 'launchd']) {
    await cp(new URL(`../${folder}`, import.meta.url), join(repo, 'board', folder), { recursive: true });
  }
  await cp(new URL('../../config.json', import.meta.url), join(repo, 'config.json'));
  await cp(new URL('./sample.json', import.meta.url), join(repo, 'sample.json'));
  await writeFile(join(repo, 'board/package.json'), '{"type":"module"}');
  git('add', '.');
  git('commit', '-m', 'feat(board): initial fixture');
  git('clone', '--bare', repo, origin);
  git('remote', 'add', 'origin', origin);
  git('fetch', 'origin');
  return { dir, repo, origin, env, git };
}
