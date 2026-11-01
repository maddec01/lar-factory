import { expect, test, vi } from 'vite-plus/test';
import { $, chooseOption, mountPage, openOptions, settle, text } from '../../test/support.ts';
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

const syncNeed = () => dialog()!.querySelector('[data-sync-need]');

test('the sync checkbox shows linked-work as the fixed label it needs, only with sync on', async () => {
  await openOnboarding([project('app', { repo: 'team/app' })], { '/api/onboarding/detect': { detection: detection({ repo: 'team/app' }) } });
  await pick('app');
  expect(text(syncNeed())).toContain('Needs this label, which the factory creates and manages:');
  expect(text(syncNeed())).toContain('linked-work');
  await settle(() => dialog()!.querySelector<HTMLInputElement>('[data-work-step] input[type="checkbox"]')!.click());
  expect(syncNeed()).toBeNull();
});

test('on Azure the sync checkbox says no tag is needed', async () => {
  const repo = 'organization/project/repository';
  await openOnboarding([project('app', { repo, provider: 'Azure DevOps' })], {
    '/api/onboarding/detect': { detection: detection({ repo, provider: 'Azure DevOps', itemSources: { found: [{ kind: 'azure-board', team: 'Team' }] } }) },
  });
  await pick('app');
  expect(text(syncNeed())).toBe('No tag is needed. Azure DevOps stores these links itself.');
});

const accessRow = (name: string) => [...dialog()!.querySelectorAll('[data-access-step] li')].find((row) => row.textContent?.includes(name));

test('the access step lists label management without letting it block adding the repository', async () => {
  const found = detection(); found.access['manage-labels'] = 'refused';
  await openOnboarding([project('lar-web')], { '/api/onboarding/detect': { detection: found } });
  await pick();
  await settle(() => button('Next').click());
  expect(text(accessRow('Manage labels'))).toContain('Needs access');
  expect(text(dialog())).toContain('You can add this repository without it.');
  expect(button('Add repository').disabled).toBe(false);
});

test('the access step names tags and shows Ready when Azure allows managing them', async () => {
  const repo = 'organization/project/repository';
  await openOnboarding([project('app', { repo, provider: 'Azure DevOps' })], {
    '/api/onboarding/detect': { detection: detection({ repo, provider: 'Azure DevOps', itemSources: { found: [{ kind: 'azure-board', team: 'Team' }] } }) },
  });
  await pick('app');
  await settle(() => button('Next').click());
  expect(text(accessRow('Manage tags'))).toContain('Ready');
  expect(text(dialog())).not.toContain('You can add this repository without it.');
});

const issueSetting = (key: string) => dialog()!.querySelector<HTMLInputElement>(`[data-setting="${key}"] input`)!;

test('onboarding starts issue defaults on and sends individual choices', async () => {
  const repo = 'team/app';
  await openOnboarding([project('app', { repo })], { '/api/onboarding/detect': { detection: detection({ repo }) }, '/api/onboarding/setup': { error: null } });
  await pick('app');
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

test('Azure onboarding picks its team in the design system Select, whose list opens above the dialog', async () => {
  const repo = 'organization/project/repository';
  await openOnboarding([project('app', { repo, provider: 'Azure DevOps' })], {
    '/api/onboarding/detect': { detection: detection({ repo, provider: 'Azure DevOps', itemSources: { found: [{ kind: 'azure-board', team: 'Fiber' }, { kind: 'azure-board', team: 'Docs' }] } }) },
  });
  await pick('app');
  const team = dialog()!.querySelector<HTMLElement>('[role="combobox"][aria-label="Team"]')!;
  expect(await openOptions(team)).toEqual(['Fiber', 'Docs']);
  expect(dialog()!.compareDocumentPosition($('[role="listbox"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await chooseOption(team, 'Docs');
  expect(text(team)).toBe('Docs');
  expect(dialog()).not.toBeNull();
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

const vocabularyDiscovery = { provider: 'github', types: { state: 'unsupported', reason: 'No issue types here.' }, labels: { state: 'available', choices: ['bug', 'linked-work'] } };
const kindRow = (key: string) => dialog()!.querySelector<HTMLElement>(`[data-vocabulary="${key}"]`)!;
const rowButton = (key: string, label: string) => [...kindRow(key).querySelectorAll<HTMLButtonElement>('button:not([role="combobox"])')].find((b) => text(b) === label)!;
const mapping = () => dialog()!.querySelector<HTMLDetailsElement>('[data-kind-mapping]')!;
/** Opens the mapping as a click does; jsdom answers a details' toggle on a timer. */
async function openMapping() {
  await settle(() => mapping().querySelector('summary')!.click());
  await settle(() => vi.advanceTimersByTime(0));
}

async function workStep() {
  await openOnboarding([project('app', { repo: 'team/app' })], {
    '/api/onboarding/detect': { detection: detection({ repo: 'team/app' }) },
    '/api/onboarding/vocabulary': { discovery: vocabularyDiscovery },
    '/api/onboarding/setup': { error: 'Provider unavailable. Draft kept.' },
  });
  await pick('app');
}

test('the mapping is folded, marked optional and reads nothing until opened, so finishing without it sends no mapping', async () => {
  await workStep();
  expect(mapping().open).toBe(false);
  expect(text(mapping().querySelector('summary'))).toContain('Map kinds to labels and types');
  expect(text(mapping().querySelector('summary'))).toContain('Optional');
  expect(posted('/api/onboarding/vocabulary')).toEqual([]);
  await settle(() => button('Next').click());
  await settle(() => button('Add repository').click());
  const body = posted('/api/onboarding/setup')[0]!;
  expect(body).not.toHaveProperty('vocabulary');
  expect(body).not.toHaveProperty('newLabels');
});

test('on Azure the mapping names tags', async () => {
  const repo = 'organization/project/repository';
  await openOnboarding([project('app', { repo, provider: 'Azure DevOps' })], {
    '/api/onboarding/detect': { detection: detection({ repo, provider: 'Azure DevOps', itemSources: { found: [{ kind: 'azure-board', team: 'Team' }] } }) },
  });
  await pick('app');
  expect(text(mapping().querySelector('summary'))).toContain('Map kinds to tags and types');
});

test('opening the mapping changes nothing, and its suggestions stay out of the save', async () => {
  await workStep();
  await openMapping();
  expect(kindRow('bug').querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  await settle(() => button('Next').click());
  await settle(() => button('Add repository').click());
  const body = posted('/api/onboarding/setup')[0]!;
  expect(body).not.toHaveProperty('vocabulary');
  expect(body).not.toHaveProperty('newLabels');
});

test('the mapping never offers the label sync needs', async () => {
  await workStep();
  await openMapping();
  expect(text(kindRow('bug'))).toContain('bug');
  expect(text(kindRow('bug'))).not.toContain('linked-work');
});

test('onboarding saves explicit suggestions and none and keeps failed new label drafts', async () => {
  await workStep();
  await openMapping();
  await settle(() => rowButton('bug', 'Use suggested label: bug').click());
  await settle(() => rowButton('feature', 'None').click());
  const input = kindRow('bug').querySelector<HTMLInputElement>('input[type="text"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'triage');
  await settle(() => input.dispatchEvent(new Event('input', { bubbles: true })));
  expect(posted('/api/onboarding/setup')).toEqual([]);
  await settle(() => button('Next').click());
  await settle(() => button('Save and add repository').click());
  expect(posted('/api/onboarding/setup')[0]).toMatchObject({ vocabulary: { bug: { type: null, labels: ['bug'] }, feature: { type: null, labels: [] } }, newLabels: { bug: ['triage'] } });
  expect(text(dialog())).toContain('Provider unavailable. Draft kept.');
  await settle(() => button('Back').click());
  expect(mapping().open).toBe(true);
  expect(kindRow('bug').querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('triage');
});

test('unreadable vocabulary can be skipped and a retry never submits a mapping', async () => {
  let unreadable = true;
  await openOnboarding([project('app', { repo: 'team/app' })], {
    '/api/onboarding/detect': { detection: detection({ repo: 'team/app' }) },
    '/api/onboarding/vocabulary': () => unreadable ? { error: 'Metadata unavailable.' } : { discovery: vocabularyDiscovery },
    '/api/onboarding/setup': { error: null },
  });
  await pick('app');
  await openMapping();
  expect(text(dialog())).toContain('Metadata unavailable.');
  expect(button('Next').disabled).toBe(false);
  unreadable = false;
  await settle(() => [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === 'Retry')!.click());
  expect(kindRow('bug')).not.toBeNull();
  await settle(() => button('Next').click());
  await settle(() => button('Add repository').click());
  expect(posted('/api/onboarding/setup')[0]).not.toHaveProperty('vocabulary');
});

test('resumed onboarding opens the mapping on its drafts and blocks mappings after Access is lost', async () => {
  const repo = 'team/app';
  const choices: OnboardingChoices = { structureSync: false, vocabulary: { bug: { type: null, labels: ['bug'] } }, newLabels: { bug: ['triage'] } };
  const data = { ...empty, onboarding: [{ repo, progress: { step: 'work', done: ['project'], answers: { projectId: 'app', choices } } }] };
  const found = detection({ repo }); found.access['tag-ticket'] = 'refused';
  serve(data, [project('app', { repo, onBoard: true })], { error: null }, 200, {
    '/api/onboarding/detect': { detection: found }, '/api/onboarding/vocabulary': { discovery: vocabularyDiscovery }, '/api/onboarding/setup': { error: null },
  });
  await mountPage(data);
  await settle(() => $<HTMLButtonElement>(`[data-onboarding-card="${repo}"] [data-resume]`)!.click());
  expect(mapping().open).toBe(true);
  expect(kindRow('bug').querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('triage');
  expect(button('Next').disabled).toBe(true);
  expect(text(kindRow('bug'))).toContain('refused');
  await settle(() => rowButton('bug', 'None').click());
  expect(button('Next').disabled).toBe(false);
  await settle(() => button('Next').click());
  await settle(() => button('Add repository').click());
  expect(posted('/api/onboarding/setup')[0]).toMatchObject({ vocabulary: { bug: { type: null, labels: [] } } });
  expect(posted('/api/onboarding/setup')[0]).not.toHaveProperty('newLabels');
});

test('a run kept on the old vocabulary step resumes on the first step with its drafts', async () => {
  const repo = 'team/app';
  const choices: OnboardingChoices = { newLabels: { bug: ['triage'] } };
  const data = { ...empty, onboarding: [{ repo, progress: { step: 'vocabulary', done: ['project', 'work'], answers: { projectId: 'app', choices } } }] };
  serve(data, [project('app', { repo, onBoard: true })], { error: null }, 200, {
    '/api/onboarding/detect': { detection: detection({ repo }) }, '/api/onboarding/vocabulary': { discovery: vocabularyDiscovery },
  });
  await mountPage(data);
  await settle(() => $<HTMLButtonElement>(`[data-onboarding-card="${repo}"] [data-resume]`)!.click());
  expect(heading()).toBe('Repository');
  await settle(() => button('Next').click());
  expect(kindRow('bug').querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('triage');
});
