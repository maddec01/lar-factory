import { expect, test } from 'vite-plus/test';
import { $, mountPage, sample, settle, text } from '../../test/support.ts';
import type { BoardData } from '@lar-factory/shared';
import { dialog, empty, openOnboarding, project, serve } from './onboarding-support.ts';

const worktree = project('worktree', { repo: null, provider: null, blocked: 'linked-worktree' });
const gitlab = project('gitlab', { repo: null, provider: null, blocked: 'no-provider-origin' });
const added = project('added', { onBoard: true });
const setUp = project('set-up', { onBoard: true });
const onboarding = (repo: string, step = 'work'): BoardData['onboarding'] => [{ repo, progress: { step, done: [], answers: { projectId: 'set-up' } } }];

const choices = () => [...dialog()!.querySelectorAll('[data-choice]')].map((row) => row.getAttribute('data-choice'));
const section = (name: string) => dialog()!.querySelector<HTMLDetailsElement>(`[data-project-section="${name}"]`);
const rows = (name: string) => [...section(name)!.querySelectorAll('li')];

test('the list holds the pickable projects in order, with Add a repository folder last', async () => {
  await openOnboarding([project('web'), worktree, added, project('api', { provider: 'Azure DevOps' })]);
  expect(choices()).toEqual(['web', 'api', 'new']);
  const web = dialog()!.querySelector('[data-choice="web"]')!;
  expect(text(web)).toContain('web');
  expect(text(web)).toContain('GitHub');
  expect(text(dialog()!.querySelector('[data-choice="api"]'))).toContain('Azure DevOps');
  expect(web.querySelector('[data-project-icon]')).not.toBeNull();
});

test('a row shows its path from ~, with the full path on hover and for screen readers', async () => {
  await openOnboarding([project('web')]);
  const shown = dialog()!.querySelector<HTMLElement>('[data-choice="web"] [data-project-path]')!;
  expect(text(shown)).toBe('~/Developer/web');
  expect(shown.title).toBe('/Users/me/Developer/web');
  expect(shown.className).toContain('truncate');
  const radio = dialog()!.querySelector<HTMLElement>('[data-choice="web"] [role="radio"]')!;
  const label = dialog()!.querySelector<HTMLLabelElement>(`label[for="${radio.id}"]`)!;
  expect(label.querySelector('.sr-only')!.textContent).toBe('/Users/me/Developer/web');
});

test('both sections count their projects and start collapsed, and their rows cannot be selected', async () => {
  await openOnboarding([project('web'), added, setUp, worktree, gitlab], {}, { ...sample, onboarding: onboarding('maddec01/set-up') });
  expect(text(section('added')!.querySelector('summary'))).toBe('Already added (2)');
  expect(text(section('blocked')!.querySelector('summary'))).toBe("Can't be added (2)");
  expect([section('added')!.open, section('blocked')!.open]).toEqual([false, false]);
  expect(text(rows('added')[0])).toContain('Added');
  expect(text(rows('added')[1])).toContain('Setup in progress');
  expect(text(rows('blocked')[0])).toContain('This folder is a git worktree. Add its main checkout instead.');
  expect(text(rows('blocked')[1])).toContain('This folder has no GitHub or Azure DevOps origin.');
  for (const name of ['added', 'blocked']) {
    expect(section(name)!.closest('[data-slot="radio-group"]')).toBeNull();
    expect(section(name)!.querySelector('[role="radio"]')).toBeNull();
  }
});

test('an empty section does not render', async () => {
  await openOnboarding([project('web'), worktree]);
  expect(section('added')).toBeNull();
  expect(section('blocked')).not.toBeNull();
});

test('a resumed setup keeps its own project selectable and checked', async () => {
  const data = { ...empty, onboarding: onboarding('maddec01/set-up', 'project') };
  serve(data, [setUp, added]);
  await mountPage(data);
  await settle(() => $<HTMLButtonElement>('[data-onboarding-card="maddec01/set-up"] [data-resume]')!.click());
  expect(choices()).toEqual(['set-up', 'new']);
  expect(dialog()!.querySelector('[data-choice="set-up"] [role="radio"]')!.getAttribute('aria-checked')).toBe('true');
  expect(rows('added')).toHaveLength(1);
});
