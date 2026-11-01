import { expect, test } from 'vite-plus/test';
import { $, fetchMock, mountPage, sample, settle } from '../../test/support.ts';


test('Added to List offers Queue beside View item', async () => {
  await mountPage(sample);
  const { notify } = await import('./notices.tsx');
  await settle(() => notify({ verb: 'Added', item: sample.items[0]!, to: 'List' }));
  expect($('[data-toast="notice"]')?.textContent).toContain('Queue');
});

test('Queue holds feedback, coordinates requests and hands focus to View item', async () => {
  await mountPage(sample);
  const { notify } = await import('./notices.tsx');
  const item = sample.items.find((value) => value.status === 'List')!;
  await settle(() => notify({ verb: 'Added', item, to: 'List' }));
  let finish!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-toast="notice"] button')).find((value) => value.textContent === 'Queue')!;
  button.focus();
  await settle(() => { button.click(); button.click(); });
  expect(button.getAttribute('aria-disabled')).toBe('true');
  expect($('[data-toast="notice"]')?.textContent).toContain('Queueing');
  await settle(() => finish(new Response(JSON.stringify({ error: null, board: { ...sample, items: sample.items.map((value) => value.id === item.id ? { ...value, status: 'Queued' } : value) } }))));
  expect($('[data-toast="notice"]')?.textContent).toContain('to Queued');
  expect(document.activeElement?.textContent).toBe('View item');
});

test('a dismissed pending notice stays gone when its request settles', async () => {
  await mountPage(sample);
  const { notify } = await import('./notices.tsx');
  const { clearToast } = await import('./toasts.tsx');
  const item = sample.items.find((value) => value.status === 'List')!;
  await settle(() => notify({ verb: 'Added', item, to: 'List' }));
  let finish!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  await settle(() => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-toast="notice"] button')).find((value) => value.textContent === 'Queue')!.click());
  await settle(() => clearToast('notice'));
  await settle(() => finish(new Response(JSON.stringify({ error: 'Refused' }))));
  expect($('[data-toast="notice"]')).toBeNull();
});

test('Queue failure becomes a danger alert and permits retry in place', async () => {
  await mountPage(sample);
  const { notify } = await import('./notices.tsx');
  const item = sample.items.find((value) => value.status === 'List')!;
  await settle(() => notify({ verb: 'Added', item, to: 'List' }));
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-toast="notice"] button')).find((value) => value.textContent === 'Queue')!;
  button.focus();
  fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: 'Refused' })));
  await settle(() => button.click());
  expect($('[data-toast="notice"]')?.closest('[data-slot="toast"]')?.getAttribute('data-toast-color')).toBe('danger');
  expect($('[data-toast="notice"] [role="alert"]')?.textContent).toBe('Refused');
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute('aria-disabled')).toBe('false');
});
