// The loading screen on the board page: it covers the board from the first paint until the first read settles and
// the mark has drawn, then fades out; it comes back when the server's first read is unsettled again.

import { expect, test, vi } from 'vite-plus/test';
import type { BoardData, FirstRead } from '@lar-factory/shared';
import { $, $$, NOW, mountPage, push, sample, settle, text } from '../../test/support.ts';

const DRAW_MS = 1750;
const EXIT_MS = 600;
const ROLL_MS = 380;

const firstRead = (step: FirstRead['step'], running: string[] = [], settled = false): FirstRead => ({ step, running, settled });
const unsettled = (read: FirstRead = firstRead('repositories')): BoardData => ({ ...sample, fetchedAt: null, firstRead: read });
const settled = (): BoardData => ({ ...sample, error: null, fetchedAt: new Date(NOW).toISOString(), firstRead: firstRead('finishing', [], true) });

const screen = () => $('.loading-screen');
const line = () => text($('.loading-line-slot > span:not(.loading-roll-out)'));
const leaving = () => screen()?.classList.contains('is-leaving') ?? false;
const advance = (ms: number) => settle(() => vi.advanceTimersByTime(ms));
const covered = () => $('#app')!.hasAttribute('inert');
const reduceMotion = () => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), addEventListener: () => {}, removeEventListener: () => {} }));

test('the board page opens on the loading screen, over the board, with the mark undrawn and the first step named', async () => {
  await mountPage(unsettled());
  expect(screen()).not.toBeNull();
  expect(screen()!.hasAttribute('role'), 'the lockup is not announced').toBe(false);
  expect($('.loading-line')!.getAttribute('role'), 'only the step line is live').toBe('status');
  expect(text($('.loading-wordmark'))).toBe('arFactory');
  expect(screen()!.classList.contains('is-drawn')).toBe(false);
  expect(line()).toBe('Checking repositories');
  expect($('.title-bar'), 'the board is under the screen').not.toBeNull();
});

test('the line names the running reads, drops each as it finishes, and the screen waits while the read is unsettled', async () => {
  await mountPage(unsettled(firstRead('items', ['lar-apple', 'lar-server'])));
  expect(line()).toBe('Reading lar-apple and lar-server');

  await push(unsettled(firstRead('items', ['lar-server'])));
  expect(line()).toBe('Reading lar-server');
  await advance(10_000);
  expect(screen(), 'an unsettled read keeps the screen').not.toBeNull();
  expect(leaving()).toBe(false);
});

test('a new step rolls the old line out while the new one rolls in, and only the line animates', async () => {
  await mountPage(unsettled());
  expect($('.loading-roll-in'), 'the first line arrives with the page, so it does not roll').toBeNull();
  const mark = $('.loading-mark');

  await push(unsettled(firstRead('items', ['lar-apple'])));
  expect(text($('.loading-roll-out'))).toBe('Checking repositories');
  expect(text($('.loading-roll-in'))).toBe('Reading lar-apple');
  expect($('.loading-mark'), 'the mark is not redrawn').toBe(mark);
  expect($('.loading-roll-out')!.getAttribute('aria-hidden'), 'the leaving line is not announced').toBe('true');
  expect($('.loading-roll-in')!.hasAttribute('aria-hidden')).toBe(false);

  await advance(ROLL_MS + 50);
  expect($('.loading-roll-out')).toBeNull();
  expect(text($('.loading-line'))).toBe('Reading lar-apple');
});

test('a read that settles at once still keeps the screen until the draw has finished, then fades over 600 ms', async () => {
  await mountPage(settled());
  expect(screen()).not.toBeNull();
  await advance(DRAW_MS - 1);
  expect(leaving()).toBe(false);
  await advance(1);
  expect(leaving()).toBe(true);
  await advance(EXIT_MS - 1);
  expect(screen()).not.toBeNull();
  await advance(1);
  expect(screen()).toBeNull();
});

test('the screen waits for the draw even when the read settled long before, and for the read when the draw is done', async () => {
  await mountPage(unsettled());
  await advance(DRAW_MS + 2_000);
  expect(leaving(), 'drawn but unsettled').toBe(false);
  await push(settled());
  expect(leaving()).toBe(true);
});

test.each([
  ['the repositories are read, zero of them included', { ...settled(), repos: [], items: [], onboarding: [] }],
  ['the read fails', { ...settled(), fetchedAt: null, error: 'gh api failed' }],
  ['gh blocks the read', { ...settled(), fetchedAt: null, error: null, tools: { ...sample.tools!, gh: { result: 'missing' as const, fix: 'Install gh' } } }],
])('the screen ends the same way when %s', async (_name, data) => {
  await mountPage({ ...unsettled(), ...data, firstRead: firstRead('repositories') });
  await push({ ...data, firstRead: firstRead('finishing', [], true) });
  await advance(DRAW_MS);
  expect(leaving()).toBe(true);
  await advance(EXIT_MS);
  expect(screen()).toBeNull();
});

test("the screen leaves once a repository's items land, though another repository still reads", async () => {
  await mountPage(unsettled(firstRead('items', ['lar-server', 'lar-apple'])));
  await advance(DRAW_MS);
  expect(leaving()).toBe(false);
  await push(unsettled({ ...firstRead('items', ['lar-server']), waiting: ['maddec01/lar-server'] }));
  expect(leaving()).toBe(true);
  await advance(EXIT_MS);
  expect(screen()).toBeNull();
});

test('a page opened with ?loading=drawn starts with the mark drawn and leaves at once when the read has settled', async () => {
  await mountPage(settled(), '', '?loading=drawn');
  expect(screen()!.classList.contains('is-drawn')).toBe(true);
  expect(leaving()).toBe(true);
  await advance(EXIT_MS);
  expect(screen()).toBeNull();
});

test('a drawn page still waits for an unsettled read, with its current step and no roll', async () => {
  await mountPage(unsettled(firstRead('items', ['lar-server'])), '', '?loading=drawn');
  expect(screen()!.classList.contains('is-drawn')).toBe(true);
  expect(leaving()).toBe(false);
  expect(line()).toBe('Reading lar-server');
  expect($('.loading-roll-in')).toBeNull();
});

test('without the flag a browser visit draws the mark', async () => {
  await mountPage(unsettled(), '', '?other=1');
  expect(screen()!.classList.contains('is-drawn')).toBe(false);
  await advance(DRAW_MS);
  expect(screen()!.classList.contains('is-drawn')).toBe(true);
});

test('a restarted server brings the screen back with its steps and the mark already drawn', async () => {
  await mountPage(settled());
  await advance(DRAW_MS);
  await advance(EXIT_MS);
  expect(screen()).toBeNull();

  await push(unsettled(firstRead('items', ['lar-apple'])));
  expect(screen()).not.toBeNull();
  expect(screen()!.classList.contains('is-drawn')).toBe(true);
  expect(line()).toBe('Reading lar-apple');

  await push(settled());
  expect(leaving()).toBe(true);
  await advance(EXIT_MS);
  expect(screen()).toBeNull();
});

test('data that goes unsettled during the fade brings the screen back', async () => {
  await mountPage(settled());
  await advance(DRAW_MS);
  expect(leaving()).toBe(true);
  await push(unsettled());
  expect(leaving()).toBe(false);
  await advance(EXIT_MS * 2);
  expect(screen()).not.toBeNull();
});

test('with reduced motion the finished mark shows at once, the line swaps without rolling and the exit stays a fade', async () => {
  reduceMotion();
  await mountPage(unsettled());
  expect(screen()!.classList.contains('is-drawn')).toBe(true);

  await push(unsettled(firstRead('items', ['lar-apple'])));
  expect($$('.loading-line-slot > span')).toHaveLength(1);
  expect(text($('.loading-line'))).toBe('Reading lar-apple');

  await push(settled());
  expect(leaving(), 'no draw to wait for').toBe(true);
  await advance(EXIT_MS);
  expect(screen()).toBeNull();
});

test('steps that change within one roll replace the incoming line without starting another roll', async () => {
  await mountPage(unsettled());
  const slot = $('.loading-line-slot')!;

  await push(unsettled(firstRead('items')));
  const incoming = $('.loading-roll-in');
  await advance(50);
  await push(unsettled(firstRead('finishing')));
  expect($$('.loading-line-slot > span'), 'one line leaving, one arriving').toHaveLength(2);
  expect(text($('.loading-roll-out')), 'the line that was on screen is the one rolling out').toBe('Checking repositories');
  expect(line()).toBe('Finishing up');
  expect($('.loading-roll-in'), 'the arriving line keeps its roll').toBe(incoming);
  expect($('.loading-line-slot')).toBe(slot);

  await advance(ROLL_MS);
  expect($$('.loading-line-slot > span')).toHaveLength(1);
  expect(line()).toBe('Finishing up');

  await push(unsettled(firstRead('items', ['lar-apple'])));
  expect(text($('.loading-roll-out')), 'a change after the roll ends rolls again').toBe('Finishing up');
  expect(line()).toBe('Reading lar-apple');
});

test('the board behind is inert while the screen is up, through the fade, and set free once it is gone', async () => {
  await mountPage(unsettled());
  expect(covered()).toBe(true);
  expect($('#app .loading-screen'), 'the screen is not inside the inert board').toBeNull();
  expect($('#app .title-bar'), 'the board is').not.toBeNull();

  await advance(DRAW_MS);
  await push(settled());
  expect(leaving()).toBe(true);
  expect(covered(), 'the fade').toBe(true);
  await push(unsettled());
  expect(leaving()).toBe(false);
  expect(covered(), 'back from the fade').toBe(true);

  await push(settled());
  await advance(EXIT_MS);
  expect(screen()).toBeNull();
  expect(covered()).toBe(false);

  await push(unsettled(firstRead('items', ['lar-apple'])));
  expect(covered(), 'a restart covers the board again').toBe(true);
});
