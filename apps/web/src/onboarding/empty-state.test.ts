// The board's main area with no repository on this Mac's list: it says so and offers Onboard a repository.

import { expect, test } from 'vite-plus/test';
import { $, mountPage, sample, text } from '../../test/support.ts';
import { dialog, empty, openOnboarding, serve } from './onboarding-support.ts';

const emptyState = () => $('[data-empty-state]');

test('with no repository onboarded the main area says so and offers Add a repository', async () => {
  serve(empty, []);
  await mountPage(empty);
  expect(text(emptyState()!.querySelector('h2'))).toBe('Add your first repository');
  expect(text($('[data-onboard]')).trim()).toBe('Add a repository');
  expect($('.desk'), 'the board stays hidden').toBeNull();
});

test('a board with a repository, or one not read yet, shows no empty state', async () => {
  await mountPage(sample);
  expect(emptyState()).toBeNull();
  serve({ ...empty, fetchedAt: null }, []);
  await mountPage({ ...empty, fetchedAt: null });
  expect(emptyState()).toBeNull();
});

test('Add a repository opens the onboarding dialog', async () => {
  await openOnboarding([]);
  expect(dialog()!.getAttribute('role')).toBe('dialog');
});
