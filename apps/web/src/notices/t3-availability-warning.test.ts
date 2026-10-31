import { expect, test } from 'vite-plus/test';
import { $, fetchMock, mountPage, push, sample, settle } from '../../test/support.ts';

const observedAt = '2026-10-31T00:00:00Z';
test('availability fixtures retain observation time and clear on recovery', async () => {
  await mountPage(sample);
  for (const availability of ['unavailable', 'renewal-required', 'unsupported-version', 'malformed'] as const) {
    await push({ ...sample, t3Availability: { availability, observedAt } });
    const warning = $(`[data-warning="t3-source:${availability}"]`)!;
    expect(warning.textContent).toContain(observedAt);
    expect(warning.querySelector('time')?.getAttribute('dateTime')).toBe(observedAt);
    expect(warning.textContent).toContain({
      unavailable: 'disconnected', 'renewal-required': 'needs renewal',
      'unsupported-version': 'unsupported', malformed: 'unreadable',
    }[availability]);
  }
  await push({ ...sample, t3Availability: { availability: 'available', observedAt } });
  expect($('[data-warning^="t3-source:"]')).toBeNull();
});

test('reauthorization reports failure and succeeds without exposing credentials', async () => {
  const degraded = { ...sample, t3Availability: { availability: 'renewal-required' as const } };
  await mountPage(degraded);
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: 'Could not reauthorize T3.' }), { status: 503 }));
  const button = () => $<HTMLButtonElement>('[data-warning="t3-source:renewal-required"] button[data-slot="button"]')!;
  await settle(() => button().click());
  expect($('[data-warning="t3-source:renewal-required"]')!.textContent).toContain('Could not reauthorize T3.');
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: null, board: { ...sample, t3Availability: { availability: 'available', observedAt } } })));
  await settle(() => button().click());
  expect($('[data-warning^="t3-source:"]')).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/t3/reauthorize')).toBe(true);
});
