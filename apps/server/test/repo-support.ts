import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'vite-plus/test';

/** The test process's environment without inherited Git variables, so a run inside a Git hook
 * or `git rebase --exec` (which set GIT_DIR and friends) never reads or writes the real repo. */
export function testEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
}

/** Git checkouts under `home`/`parent`, each with the given `origin` (or none). */
export function checkouts(home: string, origins: Record<string, string | null>, parent = 'Developer/lar'): void {
  const env = { ...testEnv(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  for (const [name, origin] of Object.entries(origins)) {
    const checkout = join(home, parent, name);
    mkdirSync(checkout, { recursive: true });
    execFileSync('git', ['init', '-q', checkout], { env });
    if (origin) execFileSync('git', ['-C', checkout, 'remote', 'add', 'origin', origin], { env });
  }
}

/** Real, isolated Git histories; no network or user Git configuration. */
export async function factoryRepo(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'Lar Factory test '));
  // Runs before a board started later is killed, so its git fetch may still be writing: retry.
  t.onTestFinished(() => rm(dir, { recursive: true, force: true, maxRetries: 10 }));
  const repo = join(dir, 'factory');
  const origin = join(dir, 'origin.git');
  const env = { ...testEnv(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  await mkdir(repo);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  await cp(new URL('../src', import.meta.url), join(repo, 'apps/server/src'), { recursive: true });
  await cp(new URL('../.gitignore', import.meta.url), join(repo, 'apps/server/.gitignore'));
  await cp(new URL('../../web/.gitignore', import.meta.url), join(repo, 'apps/web/.gitignore'));
  // The built page, which .gitignore keeps out of the fixture's commits as it does in the real repo.
  await cp(new URL('../../web/dist', import.meta.url), join(repo, 'apps/web/dist'), { recursive: true });
  await cp(new URL(import.meta.resolve('@lar-factory/shared/test/sample.json')), join(repo, 'sample.json'));
  await writeFile(join(repo, 'apps/server/package.json'), '{"type":"module"}');
  // The shared package the server imports, linked into its node_modules as pnpm links it.
  const shared = new URL('../../../packages/shared/', import.meta.url);
  for (const file of ['src', 'package.json', '.gitignore']) await cp(new URL(file, shared), join(repo, 'packages/shared', file), { recursive: true });
  await mkdir(join(repo, 'apps/server/node_modules/@lar-factory'), { recursive: true });
  await symlink('../../../../packages/shared', join(repo, 'apps/server/node_modules/@lar-factory/shared'));
  git('add', '.');
  git('commit', '-m', 'feat(board): initial fixture');
  // Use the clone transport: concurrent fixtures can fail while Git copies local loose objects.
  git('clone', '--bare', '--no-local', repo, origin);
  git('remote', 'add', 'origin', origin);
  git('fetch', 'origin');
  return { dir, repo, origin, env, git };
}
