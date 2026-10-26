// The T3 project step: T3's projects, each with its provider and whether its repository has .lar-factory.json, and
// the ones that can't be picked.

import { expect, test } from 'vite-plus/test';
import { fetchMock, settle, text } from '../../test/support.ts';
import { dialog, openOnboarding, project } from './onboarding-support.ts';

const rows = () => [...dialog()!.querySelectorAll<HTMLElement>('[data-project]')];
const row = (name: string) => rows().find((r) => r.dataset.project === name)!;
const radio = (name: string) => row(name).querySelector<HTMLElement>('[role="radio"]')!;
const badges = (name: string) => [...row(name).querySelectorAll('[data-slot="badge"]')].map(text);

test('each project shows its folder, repository, provider and whether it has .lar-factory.json', async () => {
  await openOnboarding([
    project('lar-web', { hasConfig: true }),
    project('lar-cli', { hasConfig: false }),
    project('lar-ios', { hasConfig: null }),
    project('lar-api', { repo: 'Fabrikam/lar-api', provider: 'Azure DevOps', hasConfig: null }),
  ]);
  expect(rows().map((r) => r.dataset.project)).toEqual(['lar-web', 'lar-cli', 'lar-ios', 'lar-api', 'new']);
  expect(text(row('lar-web'))).toContain('/Users/me/Developer/lar-web · maddec01/lar-web');
  expect(badges('lar-web')).toEqual(['GitHub', 'has .lar-factory.json']);
  expect(badges('lar-cli')).toEqual(['GitHub', 'no .lar-factory.json']);
  expect(badges('lar-ios')).toEqual(['GitHub', 'couldn’t check .lar-factory.json']);
  expect(badges('lar-api'), 'reading Azure DevOps waits for build #386').toEqual(['Azure DevOps']);
});

test("a repository already on the board, or a folder with no provider's origin, shows but can't be picked", async () => {
  await openOnboarding([
    project('lar-server', { onBoard: true }),
    project('notes', { repo: null, provider: null, hasConfig: null }),
  ]);
  expect(badges('lar-server')).toEqual(['GitHub', 'no .lar-factory.json', 'on the board']);
  expect(text(row('notes'))).toContain('Its folder is no main checkout with a GitHub or Azure DevOps origin.');
  for (const name of ['lar-server', 'notes']) {
    expect(radio(name).getAttribute('aria-disabled') ?? radio(name).hasAttribute('data-disabled').toString(), name).toBe('true');
    await settle(() => radio(name).click());
    expect(radio(name).getAttribute('aria-checked'), name).toBe('false');
  }
});

test("a step that can't read T3's projects shows the problem with Retry", async () => {
  await openOnboarding({ error: "Can't read T3 Code's projects at /x" });
  const alert = dialog()!.querySelector('[role="alert"]')!;
  expect(text(alert)).toContain("Can't read T3 Code's projects at /x");
  expect(text(alert.querySelector('button')).trim()).toBe('Retry');
});

test('with no T3 project the step says so', async () => {
  await openOnboarding([]);
  expect(text(dialog()!.querySelector('[data-slot="dialog-panel"]'))).toContain('T3 Code has no project yet.');
});

/** Answers Create a new T3 project's post with `body` and `status`, leaving the other requests as they were served. */
function answerCreate(body: object, status = 200): void {
  const served = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/projects' && init?.method === 'POST'
    ? new Response(JSON.stringify(body), { status }) : served(url));
}

const folderInput = () => dialog()!.querySelector<HTMLInputElement>('[data-new-folder]')!;
const addButton = () => dialog()!.querySelector<HTMLButtonElement>('[data-add-project]')!;

async function typeFolder(value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(folderInput(), value);
  await settle(() => folderInput().dispatchEvent(new Event('input', { bubbles: true })));
}

test('Create a new T3 project takes a folder, adds it, and picks the new project', async () => {
  await openOnboarding([project('lar-web')]);
  expect(text(row('new'))).toContain('Create a new T3 project');
  expect(folderInput(), 'the folder shows once the choice is made').toBeNull();
  await settle(() => radio('new').click());
  expect(addButton().disabled, 'Add waits for a folder').toBe(true);
  await typeFolder('~/Developer/lar-apple');
  answerCreate({ projects: [project('lar-web'), project('lar-apple')], projectId: 'lar-apple', error: null });
  await settle(() => addButton().click());
  await settle();
  expect(radio('lar-apple').getAttribute('aria-checked')).toBe('true');
  expect(folderInput()).toBeNull();
});

test("a failing t3 project add shows t3's message and keeps the step", async () => {
  await openOnboarding([project('lar-web')]);
  await settle(() => radio('new').click());
  await typeFolder('/Users/me/lar-apple');
  answerCreate({ error: 't3 could not add the project: Could not reach the T3 Code server.' }, 502);
  await settle(() => addButton().click());
  await settle();
  const alert = dialog()!.querySelector('[role="alert"]')!;
  expect(text(alert)).toContain('t3 could not add the project: Could not reach the T3 Code server.');
  expect(folderInput().value).toBe('/Users/me/lar-apple');
  expect(text(dialog()!.querySelector('[data-slot="dialog-title"]'))).toBe('T3 project');
});
