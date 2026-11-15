// A part's own dialog keeps the identifier its rows name it by: a ticketless part leads its title with "Part 4", and
// what it waits on leads with its reference and opens that part, as Part of opens its concept. A build that was never
// built still says it has no pull request yet, and the footer keeps Abandon in its first slot.

import type { BoardData, Item } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, $$, mountPage, sample, settle, text } from '@/test/PageTest';

const dialog = () => $('[data-item-dialog]')!;
const title = () => text(dialog().querySelector('[data-slot="modal-header"] h2'));
const asideHeadings = () => $$('[data-item-dialog] aside section h2').map((h) => text(h));

async function openItem(itemId: string): Promise<void> {
    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(itemId));
}

/** The sample board with Owner accounts (I_sample13) a ticketless Part 4 that waits on a ticketless Part 2. */
const ticketless = (): BoardData => ({
    ...sample,
    items: sample.items.map((item): Item => {
        if (item.id === 'I_sample13')
            return {
                ...item,
                number: 0,
                url: '',
                partOrder: 4,
                blockers: [
                    { number: 0, repo: item.repo, state: 'open', title: 'Direct connections', workId: 'I_sample10' },
                ],
            };

        if (item.id === 'I_sample10') return { ...item, number: 0, url: '', partOrder: 2 };

        return item;
    }),
});

test('a ticketless part’s dialog leads with its part number, and Waits on names and opens the part it waits on', async () => {
    await mountPage(ticketless());
    await openItem('I_sample13');
    expect(title()).toBe('Part 4 Owner accounts');

    const waits = dialog().querySelector<HTMLButtonElement>('[data-waits-on] [data-waits-on-open]')!;

    expect(text(waits)).toBe('Part 2 Direct connections: automatic port mapping and fallback guidance');
    await settle(() => waits.click());
    expect(title()).toBe('Part 2 Direct connections: automatic port mapping and fallback guidance');
});

test('Waits on names the done prerequisites too, each on one muted line behind a check under their count', async () => {
    const data = ticketless();

    await mountPage({
        ...data,
        items: data.items.map((item) =>
            item.id === 'I_sample13'
                ? {
                      ...item,
                      blockers: [
                          ...item.blockers,
                          { number: 0, repo: item.repo, state: 'closed', title: 'Server identity', workId: 'W_gone' },
                      ],
                  }
                : item,
        ),
    });
    await openItem('I_sample13');

    const done = dialog().querySelector('[data-waits-on-done]')!;

    expect(text(done.firstElementChild)).toBe('1 prerequisite done');
    expect([...done.querySelectorAll('li')].map(text)).toEqual(['Server identity']);
    expect(done.querySelector('li')!.className).not.toContain('line-through');
    expect(done.querySelector('li svg')).not.toBeNull();
    expect(done.querySelector('li')!.getAttribute('title')).toBe('Server identity');
});

test('Part of names the whole concept, wrapping as it needs, and opens it in the dialog', async () => {
    await mountPage();
    await openItem('I_sample13');

    const parent = dialog().querySelector<HTMLButtonElement>('[data-item-parent] [data-parent-open]')!;

    expect(text(parent)).toBe('#200 lar cloud: sign-in and direct connections');
    expect(parent.className).not.toContain('line-clamp');
    await settle(() => parent.click());
    expect(title()).toBe('#200 lar cloud: sign-in and direct connections');
});

test('a List item’s Status says it is on the List', async () => {
    await mountPage();
    await openItem('I_sample01');
    expect(text(dialog().querySelector('[data-item-summary]'))).toContain('On the List');
});

test('a build that was never built still says it has no pull request yet', async () => {
    await mountPage();
    await openItem('I_sample13');
    expect(asideHeadings()).toContain('Pull requests');
    expect(text(dialog().querySelector('aside'))).toContain('No pull request yet');
});

test('a build at Build with no pull request says it has none yet', async () => {
    await mountPage({
        ...sample,
        items: sample.items.map((item) =>
            item.id === 'I_sample13' ? { ...item, status: 'In progress', threads: [] } : item,
        ),
    });
    await openItem('I_sample13');
    expect(asideHeadings()).toContain('Pull requests');
    expect(text(dialog().querySelector('aside'))).toContain('No pull request yet');
});

const leading = () =>
    [...dialog().querySelectorAll('[data-slot="modal-footer"] :is([data-abandon], [data-back-to-list])')].map((el) =>
        el.hasAttribute('data-abandon') ? 'Abandon' : 'Move to the List',
    );

test('Abandon keeps the footer’s first slot on a List item', async () => {
    await mountPage();
    await openItem('I_sample01');
    expect(leading()).toEqual(['Abandon']);
});

test('Abandon keeps the footer’s first slot on a Queued item, Move to the List after it', async () => {
    await mountPage();
    await openItem('I_sample05');
    expect(leading()).toEqual(['Abandon', 'Move to the List']);
});

test('a blocked build its project can’t push for says why beside its disabled Start after, in the footer', async () => {
    const data = ticketless();
    const noAccess = data.repos.map((repo) =>
        repo.setup && repo.repo === 'maddec01/lar-server' ? { ...repo, setup: { ...repo.setup, access: {} } } : repo,
    );

    await mountPage({ ...data, capture: { ...data.capture, enabled: true }, repos: noAccess } as BoardData);
    await openItem('I_sample13');

    const footer = dialog().querySelector('[data-slot="modal-footer"]')!;
    const button = footer.querySelector<HTMLButtonElement>('[data-build-unavailable]')!;
    const reason = footer.querySelector('[data-start-hold]')!;

    expect(text(button)).toBe('Start after Part 2');
    expect(button.disabled).toBe(true);
    expect(text(reason)).toBe(
        'Builds need verified access to push branches and open pull requests. Recheck Project access in Settings.',
    );
    expect(button.getAttribute('aria-describedby')).toBe(reason.id);
});
