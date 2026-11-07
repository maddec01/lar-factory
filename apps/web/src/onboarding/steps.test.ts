import type { BoardData, ProjectIcon } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, mountPage, sample, settle, text } from '../../test/support.ts';
import { dialog, empty, openOnboarding, project, serve } from './onboarding-support.ts';

const worktree = project('worktree', { repo: null, provider: null, blocked: 'linked-worktree' });
const gitlab = project('gitlab', { repo: null, provider: null, blocked: 'no-provider-origin' });
const added = project('added', { onBoard: true });
const setUp = project('set-up', { onBoard: true });
const onboarding = (repo: string, step = 'work'): BoardData['onboarding'] => [
    { repo, progress: { step, done: [], answers: { projectId: 'set-up' } } },
];

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
    // A long name leaves room for some path beside the badge on a narrow page, and half the row from sm up.
    expect(shown.parentElement!.querySelector(`[title="web"]`)!.className.split(' ')).toEqual(
        expect.arrayContaining(['max-w-[30%]', 'sm:max-w-1/2']),
    );
    const radio = dialog()!.querySelector<HTMLElement>('[data-choice="web"] [role="radio"]')!;
    const label = dialog()!.querySelector<HTMLLabelElement>(`label[for="${radio.id}"]`)!;
    expect(label.querySelector('.sr-only')!.textContent).toBe('/Users/me/Developer/web');
});

test('both sections count their projects and start collapsed, and their rows cannot be selected', async () => {
    await openOnboarding(
        [project('web'), added, setUp, worktree, gitlab],
        {},
        { ...sample, onboarding: onboarding('maddec01/set-up') },
    );
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

const favicon: ProjectIcon = { kind: 'favicon', projectId: 'project:web', revision: 'abc' };
const iconOf = (row: Element | null | undefined) => row!.querySelector<HTMLElement>('[data-project-icon]')!;

test('a row of each kind shows a favicon served by project ID, a chosen icon, or the initial', async () => {
    await openOnboarding([
        project('web', { icon: favicon }),
        project('rocket', { icon: { kind: 'emoji', emoji: '🚀' } }),
        project('mono', { icon: { kind: 'monogram', text: 'LF', color: 'rose' } }),
        project('plain'),
    ]);
    const row = (name: string) => iconOf(dialog()!.querySelector(`[data-choice="${name}"]`));
    expect(row('web').querySelector('img')!.getAttribute('src')).toBe('/api/project-icon/project%3Aweb?v=abc');
    expect(text(row('web'))).toBe('W');
    expect(text(row('rocket'))).toBe('🚀');
    expect(text(row('mono'))).toBe('LF');
    expect(row('mono').className).toContain('text-rose-500');
    expect(text(row('plain'))).toBe('P');
    expect(row('plain').querySelector('img')).toBeNull();
});

test('rows in both sections show their icons, and a project with no repository takes the muted tone', async () => {
    await openOnboarding([
        project('added', { onBoard: true, icon: favicon }),
        { ...gitlab, icon: { kind: 'emoji', emoji: '🚀' } },
        worktree,
    ]);
    expect(iconOf(rows('added')[0]).querySelector('img')).not.toBeNull();
    expect(text(iconOf(rows('blocked')[0]))).toBe('🚀');
    expect(text(iconOf(rows('blocked')[1]))).toBe('W');
    expect(iconOf(rows('blocked')[1]).className).toContain('repo-tone-none');
});

test("a project on the board takes its board colour, and the initial is the name's first whole character", async () => {
    const onBoard = sample.repos[0]!.repo;
    await openOnboarding(
        [
            project('app', { repo: onBoard, onBoard: true }),
            project('🚀 ship', { id: 'ship' }),
            project('', { id: 'untitled' }),
        ],
        {},
        sample,
    );
    expect(iconOf(rows('added')[0]).className).toContain('repo-tone-0');
    expect(text(iconOf(dialog()!.querySelector('[data-choice="ship"]')))).toBe('🚀');
    expect(text(iconOf(dialog()!.querySelector('[data-choice="untitled"]')))).toBe('');
});

test("an icon fills the row's fixed square, which can't grow the row or wrap its line", async () => {
    await openOnboarding([project('web', { icon: favicon })]);
    const row = dialog()!.querySelector('[data-choice="web"]')!;
    expect(iconOf(row).className).toContain('size-4');
    expect(iconOf(row).className).toContain('shrink-0');
    expect(iconOf(row).className).toContain('overflow-hidden');
    expect(iconOf(row).querySelector('img')!.className).toContain('absolute');
    expect(iconOf(row).parentElement!.className).toContain('flex');
    expect(iconOf(row).parentElement!.className).not.toContain('flex-wrap');
});
