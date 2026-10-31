import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { effectiveVocabulary, REPOSITORY_OPERATIONS, resolveVocabulary, type RepositorySetup, type VocabularyDiscovery, type VocabularyKey, type VocabularyTerm } from '@lar-factory/shared';
import { $, $$, settle, text } from '../../test/support.ts';
import { VocabularyEditor, VocabularyTypeChoice } from './vocabulary-editor.tsx';

const setup: RepositorySetup = {
  repo: 'org/repo', role: '', itemSource: { kind: 'issues' }, labels: [], domainDocs: { kind: 'private' }, skills: [],
  ...effectiveVocabulary(), consent: [], paused: [], shared: {},
  sources: { role: 'default', itemSource: 'default', labels: 'default', domainDocs: 'default', skills: 'default', vocabulary: 'default' },
  access: Object.fromEntries(REPOSITORY_OPERATIONS.map((op) => [op, 'unverified'])) as RepositorySetup['access'],
};
const discovery: VocabularyDiscovery = { provider: 'github', types: { state: 'available', choices: ['Concept', 'Task', 'Bug'] }, labels: { state: 'available', choices: ['planning'] } };
let root: Root;
afterEach(async () => { await settle(() => root?.unmount()); });
const button = (label: string) => $$<HTMLButtonElement>('button').find((b) => text(b) === label)!;
async function mount(element: ReturnType<typeof createElement>) {
  document.body.innerHTML = '<div id="editor"></div>';
  root = createRoot(document.getElementById('editor')!);
  await settle(() => root.render(element));
}

async function press(element: Element, key: string) {
  await settle(() => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
  await settle(() => vi.advanceTimersByTime(1));
}

test('first use asks one question per step, detects a default and supports keyboard choice of nothing', async () => {
  const saved = vi.fn(async (_key: VocabularyKey, _value: VocabularyTerm | undefined) => true);
  await mount(createElement(VocabularyEditor, { setup, discovery, onSave: saved, onDone: vi.fn() }));
  expect(text($('[data-vocabulary-editor]'))).toContain('What we found');
  expect($$('fieldset')).toHaveLength(0);
  await settle(() => button('Next').click());
  expect(document.activeElement).toBe($('h3'));
  expect($$('fieldset')).toHaveLength(1);
  expect(text($('legend'))).toBe('Which type should concepts use?');
  const detected = $<HTMLButtonElement>('[role="radio"][data-state="checked"]')!;
  expect(detected.getAttribute('data-choice') ?? detected.closest('[data-choice]')?.getAttribute('data-choice')).toBe('Concept');
  await settle(() => detected.focus());
  await press(detected, 'ArrowUp');
  const none = $<HTMLButtonElement>('[data-choice=""] [role="radio"]')!;
  expect(document.activeElement).toBe(none);
  expect(none.getAttribute('data-state')).toBe('checked');
  await settle(() => button('Save and next').click());
  // Nothing is already the factory default. Merely accepting it creates no local override.
  expect(saved).not.toHaveBeenCalled();
  expect(text($('legend'))).toBe('Which labels should concepts use?');
  expect($$('fieldset')).toHaveLength(1);
  const label = $<HTMLInputElement>('input[aria-label="planning"]')!;
  await settle(() => label.click());
  await settle(() => button('Save and next').click());
  expect(saved).toHaveBeenCalledWith('concept', { type: null, labels: ['planning'] });
});

test('Refused and unsupported capability reasons stay visible and choosing nothing overrides an inherited type', async () => {
  const inherited = { ...setup, ...effectiveVocabulary({}, { concept: { type: 'Epic', labels: [] } }), shared: { vocabulary: { concept: { type: 'Epic', labels: [] } } } };
  const saved = vi.fn(async () => true);
  await mount(createElement(VocabularyEditor, { setup: inherited,
    discovery: { provider: 'azure', types: { state: 'refused', reason: 'Permission denied' }, labels: { state: 'unsupported', reason: 'Tags API unavailable' } },
    onSave: saved, onDone: vi.fn() }));
  expect(text($('[data-vocabulary-editor]'))).toContain('Refused: Permission denied');
  expect(text($('[data-vocabulary-editor]'))).toContain('Unavailable: Tags API unavailable');
  await settle(() => button('Next').click());
  expect(text($('[data-mapping-source]'))).toBe('Shared default');
  expect(button('Save and next').disabled).toBe(true);
  await settle(() => $<HTMLButtonElement>('[data-choice=""] [role="radio"]')!.click());
  await settle(() => button('Save and next').click());
  expect(saved).toHaveBeenCalledWith('concept', { type: null, labels: [] });
});

test('removing a local mapping restores the shared answer', async () => {
  const local = { ...setup, ...effectiveVocabulary({ concept: { type: null, labels: [] } }), shared: { vocabulary: { concept: { type: 'Epic', labels: [] } } } };
  const saved = vi.fn(async () => true);
  await mount(createElement(VocabularyEditor, { setup: local, discovery, onSave: saved, onDone: vi.fn() }));
  await settle(() => button('Next').click());
  await settle(() => button('Use shared default').click());
  expect(saved).toHaveBeenCalledWith('concept', undefined);
});

test('a publication conflict blocks approval until an explicit keyboard choice and keeps both requests visible', async () => {
  const { vocabulary } = effectiveVocabulary({ build: { type: 'Task', labels: [] }, bug: { type: 'Bug', labels: [] } });
  function Publication() {
    const [selected, choose] = useState<string | null | undefined>();
    const resolution = resolveVocabulary(vocabulary, 'build', 'bug', selected);
    return createElement('div', null, createElement(VocabularyTypeChoice, { resolution, onChoose: choose }), createElement('button', { disabled: !resolution.ready }, 'Approve'));
  }
  await mount(createElement(Publication));
  expect(button('Approve').disabled).toBe(true);
  expect(text($('fieldset'))).toContain('builds request Task; bugs request Bug');
  const none = $<HTMLButtonElement>('[data-choice=""] [role="radio"]')!;
  await settle(() => none.focus());
  await press(none, 'ArrowDown');
  expect(button('Approve').disabled).toBe(false);
});

test('first-use callers can save sequential answers without a board stream between steps', async () => {
  const saved = vi.fn(async (_key: VocabularyKey, _term: VocabularyTerm | undefined) => true);
  await mount(createElement(VocabularyEditor, { setup, discovery, onSave: saved, onDone: vi.fn() }));
  await settle(() => button('Next').click());
  // The detected Concept type is saved before the next question edits its labels.
  await settle(() => button('Save and next').click());
  await settle(() => $<HTMLInputElement>('input[aria-label="planning"]')!.click());
  await settle(() => button('Save and next').click());
  expect(saved).toHaveBeenLastCalledWith('concept', { type: 'Concept', labels: ['planning'] });
});
