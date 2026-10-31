import { expect, test, vi } from 'vite-plus/test';
import { $, settle, text } from '../../test/support.ts';
import { detection, dialog, openOnboarding, posted, project } from './onboarding-support.ts';

const button = (label: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>('[data-slot="modal-footer"] button')].find((b) => text(b).trim() === label)!;
const heading = () => text(dialog()!.querySelector('[data-slot="modal-header"] h2'));
async function pick() {
  await settle(() => dialog()!.querySelector<HTMLElement>('[data-choice="lar-web"] [role="radio"]')!.click());
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
