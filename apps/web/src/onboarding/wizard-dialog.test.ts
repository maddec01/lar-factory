import { expect, test, vi } from 'vite-plus/test';
import { $, mountPage, settle, text } from '../../test/support.ts';
import type { OnboardingChoices } from '@lar-factory/shared';
import { detection, dialog, empty, openOnboarding, posted, project, serve } from './onboarding-support.ts';

const button = (label: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>('[data-slot="modal-footer"] button')].find((b) => text(b).trim() === label)!;
const heading = () => text(dialog()!.querySelector('[data-slot="modal-header"] h2'));
async function pick(name = 'lar-web') {
  await settle(() => dialog()!.querySelector<HTMLElement>(`[data-choice="${name}"] [role="radio"]`)!.click());
  await settle(() => button('Next').click());
}

test('three accessible screens lead straight to the board with no ticket picker or repository PR', async () => {
  await openOnboarding([project('lar-web')], { '/api/onboarding/detect': { detection: detection() }, '/api/onboarding/setup': { error: null } });
  expect(dialog()!.getAttribute('aria-modal')).toBe('true');
  expect(heading()).toBe('Repository');
  expect((dialog()!.textContent?.match(/Step 1 of 3/g) ?? [])).toHaveLength(1);
  expect(button('Next').disabled).toBe(true);
  await pick();
  expect(heading()).toBe('Work and docs');
  expect(dialog()!.textContent).toContain('Save concepts and cross-repository links to issues');
  expect(dialog()!.querySelector('[data-import-step]')).toBeNull();
  expect(document.activeElement).toBe(dialog()!.querySelector('[data-slot="modal-header"] h2'));
  await settle(() => button('Next').click());
  expect(heading()).toBe('Access and add');
  expect(dialog()!.textContent).toContain('Save concept maps and links');
  await settle(() => button('Add repository').click());
  expect(heading()).toBe('Repository added');
  expect(posted('/api/onboarding/setup')).toHaveLength(1);
  await settle(() => button('Go to the board').click());
  await settle(() => vi.advanceTimersByTime(500));
  expect(dialog()).toBeNull();
  expect($('[data-onboard]')).not.toBeNull();
});

const issueSetting = (key: string) => dialog()!.querySelector<HTMLInputElement>(`[data-setting="${key}"] input`)!;

test('onboarding starts issue defaults on, explains linked-work, and sends individual choices', async () => {
  const repo = 'team/app';
  await openOnboarding([project('app', { repo })], { '/api/onboarding/detect': { detection: detection({ repo }) }, '/api/onboarding/setup': { error: null } });
  await pick('app');
  expect(dialog()!.textContent).toContain('linked-work label');
  for (const key of ['createIssuesFromAddItem', 'createIssuesFromRetro', 'writeRefinedSpec']) {
    expect([issueSetting(key).checked, issueSetting(key).disabled]).toEqual([true, false]);
  }
  await settle(() => issueSetting('createIssuesFromRetro').click());
  await settle(() => button('Next').click());
  await settle(() => button('Add repository').click());
  expect(posted('/api/onboarding/setup')[0]).toMatchObject({ createIssuesFromAddItem: true, createIssuesFromRetro: false, writeRefinedSpec: true });
});

test('onboarding shows access reasons and rechecks without losing the issue choices', async () => {
  const repo = 'team/app';
  let found = detection({ repo });
  await openOnboarding([project('app', { repo })], { '/api/onboarding/detect': () => ({ detection: found }) });
  await pick('app');
  await settle(() => issueSetting('createIssuesFromRetro').click());
  found = detection({ repo, access: { ...found.access, 'publish-ticket': 'refused', 'edit-ticket': 'unverified' } });
  const { useWizardStore } = await import('./wizard-store.ts');
  await settle(() => useWizardStore.getState().detect());
  for (const key of ['createIssuesFromAddItem', 'createIssuesFromRetro', 'writeRefinedSpec']) {
    expect([issueSetting(key).checked, issueSetting(key).disabled]).toEqual([false, true]);
  }
  expect(dialog()!.querySelector('[data-setting="createIssuesFromAddItem"]')!.textContent).toContain('refused');
  expect(dialog()!.querySelector('[data-setting="writeRefinedSpec"]')!.textContent).toContain('not checked yet');
  found = detection({ repo });
  const recheck = [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === 'Recheck access')!;
  await settle(() => recheck.click());
  expect([issueSetting('createIssuesFromAddItem').checked, issueSetting('createIssuesFromRetro').checked, issueSetting('writeRefinedSpec').checked]).toEqual([true, false, true]);
});

test('Azure onboarding displays the session write restriction with allowed Access', async () => {
  const repo = 'organization/project/repository';
  await openOnboarding([project('app', { repo, provider: 'Azure DevOps' })], {
    '/api/onboarding/detect': { detection: detection({ repo, provider: 'Azure DevOps', azureReadOnly: true, itemSources: { found: [{ kind: 'azure-board', team: 'Team' }] } }) },
  });
  await pick('app');
  for (const key of ['createIssuesFromAddItem', 'createIssuesFromRetro', 'writeRefinedSpec']) {
    expect([issueSetting(key).checked, issueSetting(key).disabled]).toEqual([false, true]);
    expect(dialog()!.querySelector(`[data-setting="${key}"]`)!.textContent).toContain('read-only');
  }
});

test('resuming onboarding keeps issue choices and turns legacy private docs off', async () => {
  const repo = 'team/app';
  const choices = { createIssuesFromAddItem: false, domainDocs: { kind: 'private' } } as unknown as OnboardingChoices;
  const data = { ...empty, onboarding: [{ repo, progress: { step: 'work', done: ['project'], answers: { projectId: 'app', choices } } }] };
  serve(data, [project('app', { repo, onBoard: true })], { error: null }, 200, { '/api/onboarding/detect': { detection: detection({ repo }) }, '/api/onboarding/setup': { error: null } });
  await mountPage(data);
  await settle(() => $<HTMLButtonElement>(`[data-onboarding-card="${repo}"] [data-resume]`)!.click());
  expect(issueSetting('createIssuesFromAddItem').checked).toBe(false);
  expect([...dialog()!.querySelectorAll<HTMLInputElement>('[data-work-step] input[type="checkbox"]')][1]!.checked).toBe(false);
  await settle(() => button('Next').click());
  await settle(() => button('Add repository').click());
  expect(posted('/api/onboarding/setup')[0]).toMatchObject({ createIssuesFromAddItem: false, domainDocs: { kind: 'off' } });
});

test('the access screen names the missing permission once and blocks enabled sync', async () => {
  const found = detection(); found.access['comment-ticket'] = 'refused';
  await openOnboarding([project('lar-web')], { '/api/onboarding/detect': { detection: found } });
  await pick();
  await settle(() => button('Next').click());
  expect(button('Add repository').disabled).toBe(true);
  expect(dialog()!.textContent).toContain('Issues: Read and write');
  await settle(() => button('Back').click());
  const toggle = [...dialog()!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][0]!;
  await settle(() => toggle.click());
  await settle(() => button('Next').click());
  expect(button('Add repository').disabled).toBe(false);
});

test('unverified token writes never show Ready for concept sync or builds', async () => {
  const found = detection();
  for (const op of Object.keys(found.access) as (keyof typeof found.access)[]) found.access[op] = 'unverified';
  await openOnboarding([project('lar-web')], { '/api/onboarding/detect': { detection: found } });
  await pick();
  await settle(() => button('Next').click());
  expect(button('Add repository').disabled).toBe(true);
  const rows = [...dialog()!.querySelectorAll('[data-access-step] li')];
  expect(rows.slice(1).every((row) => row.textContent?.includes('Not verified'))).toBe(true);
  expect(dialog()!.textContent).toContain('Contents and Pull requests: Read and write');
  expect(dialog()!.textContent).toContain('cannot verify fine-grained token permissions');
});
