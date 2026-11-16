// A part's own dialog keeps the identifier its rows name it by: a ticketless part leads its title with "Part 4", and
// what it waits on leads with its reference and opens that part. A build that was never built still says it has no
// pull request yet.

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

test('a build that was never built still says it has no pull request yet', async () => {
    await mountPage();
    await openItem('I_sample13');
    expect(asideHeadings()).toContain('Pull requests');
    expect(text(dialog().querySelector('aside'))).toContain('No pull request yet');
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
