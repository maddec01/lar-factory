// The Add item dialog: the New work form and each phase of a submission, and the Pick a ticket pane.

import type { BoardData } from '@lar-factory/shared';
import { beforeEach, expect, test, vi } from 'vite-plus/test';

import { typeInto } from '@/test/EditorTest';
import {
    $,
    $$,
    chooseOption,
    fetchMock,
    formValue,
    mountPage,
    openOptions,
    push,
    sample,
    settle,
    text,
    textBesideIcon,
} from '@/test/PageTest';

beforeEach(() => localStorage.removeItem('lar-board:add-item'));

/** The sample's repositories with no project setup read, so none may create issues; a test that needs one adds it. */
const withFactory: BoardData = {
    ...sample,
    repos: [
        ...sample.repos.map(({ setup: _setup, ...repo }) => repo),
        { repo: 'maddec01/lar-factory', role: 'The factory', labels: [] },
        { repo: 'maddec01/lar-empty', role: 'Empty', labels: [] },
    ],
};
const addButton = () => $<HTMLButtonElement>('.add-item')!;
const dialog = () => $('#add-item-dialog');
const field = <T extends HTMLElement = HTMLInputElement>(id: string) => $<T>(`#${id}`)!;
const submit = () => field<HTMLButtonElement>('item-submit');
const result = () => field('item-result');
const editorArea = () => $('#add-item-dialog [contenteditable]')!;

async function open(data: BoardData = withFactory): Promise<void> {
    await mountPage(data);
    // A click focuses the button it presses.
    addButton().focus();
    await settle(() => addButton().click());
    // The Modal moves focus on the next frame.
    await settle(() => vi.advanceTimersByTime(50));
}

/** Sets a field's value the way typing does, so React hears it. */
async function enter(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
    const proto = Object.getPrototypeOf(el) as object;

    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    await settle(() => el.dispatchEvent(new Event('input', { bubbles: true })));
}

async function fillDraft(): Promise<void> {
    await chooseOption(field('item-kind'), 'Bug');
    await enter(field('item-title'), 'Playback stalls');
    await typeInto(editorArea(), 'After a seek.');
}

const respond = (body: object, status = 200) =>
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(body), { status }));
const posted = () =>
    JSON.parse((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body as string) as Record<
        string,
        unknown
    >;

test.each([
    ['- a\nb', '- a\n- b'],
    ['1. a\nb', '1. a\n2. b'],
    ['# h', '# h'],
])('typing %j in the description creates the item with %j', async (typed, body) => {
    await open();
    await chooseOption(field('item-kind'), 'Bug');
    await enter(field('item-title'), 'Playback stalls');
    await typeInto(editorArea(), typed);
    respond({ item: null, error: null }, 500);
    await settle(() => submit().click());
    expect((posted().draft as Record<string, unknown>).description).toBe(body);
});

test('a description typed in Add item survives closing and reopening it', async () => {
    await open();
    await typeInto(editorArea(), '- a\nb');
    await settle(() => $<HTMLButtonElement>('#add-item-dialog button[aria-label="Close"]')!.click());
    await settle(() => vi.advanceTimersByTime(50));
    expect(dialog()).toBeNull();
    await settle(() => addButton().click());
    expect([...editorArea().querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual(['a', 'b']);
    await chooseOption(field('item-kind'), 'Bug');
    await enter(field('item-title'), 'Playback stalls');
    respond({ item: null, error: null }, 500);
    await settle(() => submit().click());
    expect((posted().draft as Record<string, unknown>).description).toBe('- a\n- b');
});

test('a draft without a kind isn’t sent and says why', async () => {
    await open();
    await enter(field('item-title'), 'Playback stalls');
    await settle(() => submit().click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result().textContent).toBe('Choose bug, feature or improvement.');
    await enter(field('item-title'), 'Playback stalls on seek');
    expect(result().textContent, 'editing clears the message').toBe('');
});

test('submitting posts the draft, shows it sending, then closes and announces the recorded work, which has no ticket number', async () => {
    await open();
    await fillDraft();

    let finish!: (response: Response) => void;

    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (finish = resolve)));
    await settle(() => submit().click());

    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/items');

    const body = posted();

    expect(body.draft).toEqual({
        createIssue: false,
        repo: 'maddec01/lar-server',
        kind: 'bug',
        title: 'Playback stalls',
        description: 'After a seek.',
    });
    expect(typeof body.requestId).toBe('string');
    expect(submit().textContent).toBe('Adding…');
    expect(submit().disabled).toBe(true);
    expect(field<HTMLFieldSetElement>('item-fields').disabled).toBe(true);
    expect(editorArea().getAttribute('contenteditable'), 'the description locks with them').toBe('false');
    expect($('#add-item-form')!.getAttribute('aria-busy')).toBe('true');
    expect(result().textContent).toBe('Adding it to List…');

    const item = { ...sample.items[0]!, id: 'work-501', title: 'Playback stalls', number: 0, url: null };
    const board = { ...sample, items: [...sample.items, item] };

    await settle(() => finish(new Response(JSON.stringify({ item, error: null, board }))));
    await settle(() => vi.advanceTimersByTime(50));
    expect(dialog(), 'the dialog closes').toBeNull();
    expect(document.activeElement, 'focus goes back to Add item').toBe(addButton());

    const toast = $('[data-slot="toast"][role="status"] [data-toast]')!;

    expect(toast.textContent).toBe('Added Playback stalls to List. View item Queue');
    expect(toast.querySelector('.dismiss')!.getAttribute('aria-label')).toBe('Dismiss: Added Playback stalls');
    expect(text($('.title-bar .list-button')), 'the board shows the new data').toBe('List5');
});

test('a refused submission keeps the draft for editing', async () => {
    await open();
    await fillDraft();
    respond({ item: null, error: null }, 500);
    await settle(() => submit().click());
    expect(result().textContent).toBe('Request failed (HTTP 500).');
    expect(field<HTMLFieldSetElement>('item-fields').disabled).toBe(false);
    expect(field('item-title').value).toBe('Playback stalls');
});

test('a lost response offers a retry', async () => {
    await open();
    await fillDraft();
    fetchMock.mockImplementationOnce(async () => {
        throw new TypeError('Failed to fetch');
    });
    await settle(() => submit().click());
    expect(result().textContent).toBe(
        'The submission response was lost. Retry this submission to recover its result without adding it twice.',
    );
    expect(submit().textContent).toBe('Retry this submission');
});

test('with no repository onboarded, adding is disabled and says where to add one, but not before the first read, beside a read error or a repository left off the board', async () => {
    const empty = { ...withFactory, repos: [], repositoryConfigProblems: [], error: null };
    const hint = () => $('#item-repo-hint');

    await open(empty);
    expect(submit().disabled).toBe(true);
    expect(dialog()!.textContent).toContain('Record work and add it to List.');
    expect(hint()!.textContent).toBe('No Project is onboarded. Read how to add a project.');
    expect(field('item-repo').getAttribute('aria-describedby')).toBe('item-repo-hint');
    for (const data of [
        { ...empty, error: 'gh: HTTP 502' },
        { ...empty, fetchedAt: null },
        {
            ...empty,
            repositoryConfigProblems: [
                { repo: 'maddec01/lar-apple', problem: 'no .lar-factory.json on its default branch.' },
            ],
        },
    ]) {
        await push(data);
        expect(hint()).toBeNull();
        expect(field('item-repo').hasAttribute('aria-describedby')).toBe(false);
        expect(submit().disabled).toBe(true);
    }
});

test('Close returns focus to Add item, and reopening keeps a draft but not a finished item', async () => {
    await open();
    await enter(field('item-title'), 'Half written');
    await settle(() => $<HTMLButtonElement>('#add-item-dialog button[aria-label="Close"]')!.click());
    await settle(() => vi.advanceTimersByTime(50));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(addButton());

    await settle(() => addButton().click());
    expect(dialog()).not.toBeNull();
    expect(field('item-title').value).toBe('Half written');

    await fillDraft();

    const item = { ...sample.items[0]!, title: 'Playback stalls', number: 501 };

    respond({ item, error: null, board: withFactory });
    await settle(() => submit().click());
    await settle(() => vi.advanceTimersByTime(50));
    expect(dialog()).toBeNull();
    await settle(() => addButton().click());
    expect(field('item-title').value).toBe('');
    expect(result().textContent).toBe('');
    expect(field<HTMLFieldSetElement>('item-fields').disabled).toBe(false);
    expect(submit().textContent).toBe('Add item');
});

/** The fetch calls to `path`, each with its body, if it has one. */
const calls = (path: string) =>
    fetchMock.mock.calls
        .map((call) => call as unknown as [string, RequestInit | undefined])
        .filter(([url]) => url.startsWith(path))
        .map(([url, init]) => [url, init?.body ? JSON.parse(init.body as string) : null]);
const ticketButton = (number: number) => $<HTMLButtonElement>(`[data-ticket="${number}"]`)!;

async function searchFor(query: string): Promise<void> {
    await enter(field('pick-query'), query);
    await settle(() => field<HTMLButtonElement>('pick-search').click());
}

test('Pick a ticket searches the repository picked and lists its open tickets, saying which are on the board already', async () => {
    await open();

    const newWorkHeight = dialog()!.style.height;

    await settle(() => $<HTMLButtonElement>('[data-pane="pick"]')!.click());
    expect($('[data-pane="pick"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(dialog()!.style.height, 'both panes keep the same dialog height').toBe(newWorkHeight);
    expect([...dialog()!.classList], 'the ticket pane does not opt into content height').not.toContain('sm:h-auto');
    expect([...$('#pick-ticket')!.classList], 'a long result list scrolls above the footer').toEqual(
        expect.arrayContaining(['min-h-0', 'overflow-y-auto']),
    );
    expect(dialog()!.textContent).toContain('Find a ticket to add or open in List.');
    expect(text($('#pick-ticket'))).toContain('Find an open ticket');
    expect(text($('#pick-ticket'))).toContain('tickets by title or #number.');
    expect(text($('#pick-ticket'))).not.toContain('Find tickets outside your list');
    await openOptions(field('pick-repo'));
    expect(
        dialog()!.compareDocumentPosition($('[role="listbox"]')!) & Node.DOCUMENT_POSITION_FOLLOWING,
        'the list opens above the dialog',
    ).toBeTruthy();
    await settle(() =>
        $$('[role="option"]')
            .find((option) => textBesideIcon(option) === 'lar-apple')!
            .click(),
    );
    await settle(() => vi.advanceTimersByTime(50));
    respond({
        tickets: [
            { number: 8, title: 'Seek stalls', url: 'u8' },
            { number: 9, title: 'Seek is slow', url: 'u9', workId: 'work-9' },
        ],
        error: null,
    });
    await searchFor('seek');
    expect(text($('#pick-ticket'))).not.toContain('Find an open ticket');
    expect(calls('/api/tickets')).toEqual([['/api/tickets?repo=maddec01%2Flar-apple&q=seek', null]]);
    expect($$('[data-ticket]').map(text)).toEqual(['#8Seek stalls', '#9Seek is slowAlready added']);
    respond({ tickets: [], error: null });
    await searchFor('nothing');
    expect(text(field('pick-result'))).toBe('Nothing matches');
});

test('picking a new ticket closes the dialog and announces it, and one on the board already opens its item', async () => {
    await open();
    await settle(() => $<HTMLButtonElement>('[data-pane="pick"]')!.click());
    respond({ tickets: [{ number: 8, title: 'Seek stalls', url: 'u8' }], error: null });
    await searchFor('seek');

    const item = { ...sample.items[0]!, id: 'work-8', number: 8, title: 'Seek stalls' };

    respond({ item, created: true, error: null, board: { ...sample, items: [...sample.items, item] } });
    await settle(() => ticketButton(8).click());
    await settle(() => vi.advanceTimersByTime(50));
    expect(calls('/api/pick-ticket')).toEqual([['/api/pick-ticket', { repo: 'maddec01/lar-server', number: 8 }]]);
    expect(dialog()).toBeNull();
    expect(text($('[data-slot="toast"][role="status"] [data-toast]'))).toBe(
        'Added #8 Seek stalls to List. View item Queue',
    );

    await settle(() => addButton().click());
    respond({ tickets: [{ number: 8, title: 'Seek stalls', url: 'u8', workId: 'work-8' }], error: null });
    await searchFor('seek');
    respond({ item, created: false, error: null, board: { ...sample, items: [...sample.items, item] } });
    await settle(() => ticketButton(8).click());
    await settle(() => vi.advanceTimersByTime(50));
    expect(dialog()).toBeNull();
    expect(text($('[data-item-dialog] [data-slot="modal-header"] h2'))).toBe('#8 Seek stalls');
});

test('Create issue starts from each repository default and an override applies only to this item', async () => {
    const { effectiveVocabulary } = await import('@lar-factory/shared');
    const repos = [true, false].map((enabled, index) => ({
        ...withFactory.repos[index]!,
        setup: {
            repo: withFactory.repos[index]!.repo,
            createIssuesFromAddItem: enabled,
            access: { 'publish-ticket': 'allowed', 'tag-ticket': 'refused', 'type-ticket': 'refused' },
            ...effectiveVocabulary(),
        },
    })) as BoardData['repos'];

    respond({
        options: {
            provider: 'github',
            labels: [],
            types: [],
            assignees: [],
            milestones: [],
            iterations: [],
            problems: [],
        },
    });
    await open({ ...withFactory, repos });
    expect(field<HTMLInputElement>('item-create-issue').checked).toBe(true);
    expect(field<HTMLInputElement>('item-create-issue').disabled).toBe(false);
    await chooseOption(field('item-repo'), 'lar-apple');
    expect(field<HTMLInputElement>('item-create-issue').checked).toBe(false);
    respond({
        options: {
            provider: 'github',
            labels: ['forbidden'],
            types: ['Bug'],
            assignees: [],
            milestones: [],
            iterations: [],
            problems: [],
        },
    });
    await settle(() => field<HTMLInputElement>('item-create-issue').click());
    expect($('#item-labels')).toBeNull();
    expect($('#item-type')).toBeNull();
    await fillDraft();
    respond({ error: 'HTTP 403: denied' }, 502);
    await settle(() => submit().click());
    expect((posted().draft as Record<string, unknown>).createIssue).toBe(true);
    expect(dialog()).not.toBeNull();
    expect(field('item-title').value).toBe('Playback stalls');
});

test('a lost response keeps its request ID after the page reloads', async () => {
    await open();
    await fillDraft();
    fetchMock.mockImplementationOnce(async () => {
        throw Error('Connection lost');
    });
    await settle(() => submit().click());

    const requestId = posted().requestId;

    vi.resetModules();
    await open();
    expect(field('item-title').value).toBe('Playback stalls');
    expect(submit().textContent).toBe('Retry this submission');
    respond({ uncertain: true, error: 'Check the board.' }, 409);
    await settle(() => submit().click());
    expect(posted().requestId).toBe(requestId);
    expect(submit().disabled).toBe(true);
});

const picked = () => $$<HTMLInputElement>('#item-labels input[name="labels"]').map((input) => input.value);
const typedLabels = () => $$<HTMLInputElement>('#item-labels input[name="newLabels"]').map((input) => input.value);
const chips = () => $$('#item-labels [data-label-chip]').map(text);
const choices = () => $$<HTMLLabelElement>('[data-label-choice]');
const choice = (name: string) => choices().find((c) => text(c).startsWith(name))!;
const search = () => $<HTMLInputElement>('[data-label-picker] input[aria-label]')!;
const openPicker = () => settle(() => $<HTMLButtonElement>('#item-labels button')!.click());
const toggle = (name: string) => settle(() => choice(name).querySelector('input')!.click());
const createButton = () =>
    $$<HTMLButtonElement>('[data-label-picker] button').find((b) => text(b).startsWith('Create'));

/** A repository that reads `labels`, whose bug and feature map to labels and which has `access` besides ticket creation. */
function labelledRepo(
    effectiveVocabulary: typeof import('@lar-factory/shared').effectiveVocabulary,
    labels: string[],
    {
        access = {},
        repo = withFactory.repos[0]!.repo,
        createIssuesFromAddItem = true,
        bug = ['backend'],
        feature = ['triage'],
    }: { access?: object; repo?: string; createIssuesFromAddItem?: boolean; bug?: string[]; feature?: string[] } = {},
) {
    const config = {
        ...withFactory.repos[0]!,
        repo,
        setup: {
            repo,
            createIssuesFromAddItem,
            access: { 'publish-ticket': 'allowed', 'tag-ticket': 'allowed', 'manage-labels': 'allowed', ...access },
            ...effectiveVocabulary({ bug: { type: null, labels: bug }, feature: { type: null, labels: feature } }),
        },
    } as BoardData['repos'][number];
    const data = { ...withFactory, repos: [config] };
    const provider = repo.split('/').length === 3 ? 'azure' : 'github';

    fetchMock.mockImplementation(
        async (url) =>
            new Response(
                JSON.stringify(
                    url.startsWith('/api/ticket-options')
                        ? {
                              options: {
                                  provider,
                                  labels,
                                  labelColors: { docs: '0E8A16' },
                                  types: [],
                                  assignees: [],
                                  milestones: [],
                                  iterations: [],
                                  problems: [],
                              },
                          }
                        : data,
                ),
            ),
    );

    return data;
}

const labelSetup = async (labels: string[], options?: Parameters<typeof labelledRepo>[2]) => {
    const { effectiveVocabulary } = await import('@lar-factory/shared');

    await open(labelledRepo(effectiveVocabulary, labels, options));
};

test('Create issue follows the repository until the user changes it, and the change survives closing the dialog', async () => {
    const { effectiveVocabulary } = await import('@lar-factory/shared');
    const repos = [true, false].map((enabled, index) => ({
        ...withFactory.repos[index]!,
        setup: {
            repo: withFactory.repos[index]!.repo,
            createIssuesFromAddItem: enabled,
            access: { 'publish-ticket': 'allowed' },
            ...effectiveVocabulary(),
        },
    })) as BoardData['repos'];
    const data = { ...withFactory, repos };

    fetchMock.mockImplementation(
        async (url) =>
            new Response(
                JSON.stringify(
                    url.startsWith('/api/ticket-options')
                        ? {
                              options: {
                                  provider: 'github',
                                  labels: [],
                                  types: [],
                                  assignees: [],
                                  milestones: [],
                                  iterations: [],
                                  problems: [],
                              },
                          }
                        : data,
                ),
            ),
    );
    await open(data);

    const box = () => field<HTMLInputElement>('item-create-issue');

    expect(box().checked).toBe(true);
    await chooseOption(field('item-repo'), 'lar-apple');
    expect(box().checked, 'it follows the repository').toBe(false);
    await chooseOption(field('item-repo'), 'lar-server');
    expect(box().checked, 'and back').toBe(true);
    await settle(() => box().click());
    expect(box().checked).toBe(false);
    await chooseOption(field('item-repo'), 'lar-apple');
    await settle(() => box().click());
    await chooseOption(field('item-repo'), 'lar-server');
    expect(box().checked, 'the choice stays through repository changes').toBe(true);
    await settle(() => box().click());
    await settle(() => $<HTMLButtonElement>('#add-item-dialog button[aria-label="Close"]')!.click());
    await settle(() => vi.advanceTimersByTime(50));
    await settle(() => addButton().click());
    expect(box().checked, 'and through closing the dialog').toBe(false);
});

test('without create access the checkbox is off and disabled with the reason, in the footer, and submits local work', async () => {
    await labelSetup(['docs'], { access: { 'publish-ticket': 'refused' } });

    const box = field<HTMLInputElement>('item-create-issue');

    expect([box.checked, box.disabled]).toEqual([false, true]);

    const reason = document.getElementById(box.getAttribute('aria-describedby')!)!;

    expect(text(reason)).toContain('publish-ticket');
    expect(submit().parentElement!.contains(reason)).toBe(true);
    expect(text($('aside[aria-label="Details"]'))).not.toContain('Tick Create issue');
    await fillDraft();
    respond({ error: 'Denied' }, 403);
    await settle(() => submit().click());
    expect(posted().draft).toEqual({
        repo: withFactory.repos[0]!.repo,
        kind: 'bug',
        title: 'Playback stalls',
        description: 'After a seek.',
        createIssue: false,
    });
});

test('changing kind swaps its mapped labels and keeps what the user picked', async () => {
    await labelSetup(['backend', 'triage', 'docs']);
    await chooseOption(field('item-kind'), 'Bug');
    await openPicker();
    await toggle('docs');
    expect(picked()).toEqual(['backend', 'docs']);
    await settle(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await chooseOption(field('item-kind'), 'Feature');
    expect(picked()).toEqual(['docs', 'triage']);
});

test('a typed label is created on submit, is kept with the draft, and can be unticked', async () => {
    await labelSetup(['backend', 'docs']);
    await chooseOption(field('item-kind'), 'Bug');
    await enter(field('item-title'), 'Playback stalls');
    await openPicker();
    expect(search().placeholder).toBe('Filter or type a new label');
    await enter(search(), 'needs-design');
    expect(
        $$('[data-label-picker] p').some((p) => text(p) === 'No match.'),
        'the create button says what to do',
    ).toBe(false);
    await settle(() => createButton()!.click());
    expect(search().value).toBe('');
    expect(typedLabels()).toEqual(['needs-design']);
    expect(picked()).toEqual(['backend']);
    expect(chips()).toEqual(['backend', 'needs-design new']);
    expect(text($('[data-label-picker]'))).toContain('The new label is created when the ticket submits.');
    await settle(() => $<HTMLButtonElement>('#add-item-dialog button[aria-label="Close"]')!.click());
    await settle(() => vi.advanceTimersByTime(50));
    await settle(() => addButton().click());
    await settle(() => vi.advanceTimersByTime(50));
    expect(typedLabels(), 'a closed dialog keeps the typed label').toEqual(['needs-design']);
    respond({ error: 'Couldn’t create the label needs-design, so no ticket was created. HTTP 403' }, 502);
    await settle(() => submit().click());
    expect((posted().draft as { options: unknown }).options).toEqual({
        labels: ['backend'],
        newLabels: ['needs-design'],
    });
    expect(dialog(), 'a failed label creation keeps the draft open').not.toBeNull();
    expect(text(result())).toContain('Couldn’t create the label needs-design');
    expect(field('item-title').value).toBe('Playback stalls');
    expect(field<HTMLFieldSetElement>('item-fields').disabled).toBe(false);
    await openPicker();
    await toggle('needs-design');
    expect(typedLabels()).toEqual([]);
    expect(choice('needs-design'), 'it stays a choice once unticked').toBeDefined();
});

test('Enter on a typed name adds it and doesn’t submit the form', async () => {
    await labelSetup(['docs']);
    await openPicker();
    await enter(search(), 'needs-design');

    const key = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

    await settle(() => search().dispatchEvent(key));
    expect(key.defaultPrevented).toBe(true);
    expect(typedLabels()).toEqual(['needs-design']);
    expect(calls('/api/items')).toEqual([]);
});

test.each([
    ['linked-work', /reserved for the factory/],
    ['bug', /reserved for the item’s kind/],
    ['status-done', /reserved for board status/],
    ['-x', /hyphen/],
])('typing %s is refused with its reason', async (name, reason) => {
    await labelSetup(['docs']);
    await openPicker();
    await enter(search(), name);
    expect(createButton()).toBeUndefined();
    expect(text($('[data-label-picker] [role="alert"]'))).toMatch(reason);

    const key = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

    await settle(() => search().dispatchEvent(key));
    expect(typedLabels()).toEqual([]);
});

test('ticket options keep their picks in a kept draft, and changing repository reads the new one', async () => {
    const { effectiveVocabulary } = await import('@lar-factory/shared');
    const repos = withFactory.repos.slice(0, 2).map((repo) => ({
        ...repo,
        setup: {
            repo: repo.repo,
            createIssuesFromAddItem: true,
            access: { 'publish-ticket': 'allowed', 'tag-ticket': 'allowed', 'type-ticket': 'allowed' },
            ...effectiveVocabulary(),
        },
    })) as BoardData['repos'];
    const data = { ...withFactory, repos };
    const assignees = (repo: string) => (repo.includes('apple') ? ['apple-dev'] : ['writer']);

    fetchMock.mockImplementation(
        async (url) =>
            new Response(
                JSON.stringify(
                    url.startsWith('/api/ticket-options')
                        ? {
                              options: {
                                  provider: 'github',
                                  labels: [],
                                  types: [],
                                  assignees: assignees(url),
                                  milestones: [],
                                  iterations: [],
                                  problems: [],
                              },
                          }
                        : data,
                ),
            ),
    );
    await open(data);
    await chooseOption(field('item-kind'), 'Bug');
    await chooseOption(field('item-assignee'), 'writer');
    await settle(() => $<HTMLButtonElement>('#add-item-dialog button[aria-label="Close"]')!.click());
    await settle(() => vi.advanceTimersByTime(50));
    await settle(() => addButton().click());
    expect(formValue('assignee')).toBe('writer');
    await chooseOption(field('item-repo'), 'lar-apple');
    expect(formValue('assignee'), 'the other repository starts at None').toBe('');
    await chooseOption(field('item-assignee'), 'apple-dev');
    await enter(field('item-title'), 'Playback stalls');
    respond({ error: 'Denied' }, 403);
    await settle(() => submit().click());
    expect(posted().draft).toMatchObject({
        repo: 'maddec01/lar-apple',
        kind: 'bug',
        options: { assignee: 'apple-dev' },
    });
});
