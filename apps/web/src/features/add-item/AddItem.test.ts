// The Add item dialog: the New work form and each phase of a submission, and the Pick a ticket pane.

import type { BoardData } from '@lar-factory/shared';
import { beforeEach, expect, test, vi } from 'vite-plus/test';

import { typeInto } from '@/test/EditorTest';
import { $, $$, chooseOption, fetchMock, mountPage, sample, settle, text } from '@/test/PageTest';

beforeEach(() => localStorage.removeItem('lar-board:add-item'));

/** The sample's repositories with no project setup read, so none may create issues; a test that needs one adds it. */
const withFactory: BoardData = {
    ...sample,
    repos: [
        ...sample.repos.map(({ setup: _setup, ...repo }) => repo),
        { repo: 'maddec01/lar-factory', role: 'The factory', labels: [] },
        { repo: 'acme/empty', role: 'Empty', labels: [] },
    ],
};
const addButton = () => $<HTMLButtonElement>('[data-add-item]')!;
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
        repo: 'acme/api',
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
    expect(result().textContent).toBe('Adding it to the List…');

    const item = { ...sample.items[0]!, id: 'work-501', title: 'Playback stalls', number: 0, url: null };
    const board = { ...sample, items: [...sample.items, item] };

    await settle(() => finish(new Response(JSON.stringify({ item, error: null, board }))));
    await settle(() => vi.advanceTimersByTime(50));
    expect(dialog(), 'the dialog closes').toBeNull();
    expect(document.activeElement, 'focus goes back to Add item').toBe(addButton());

    const toast = $('[data-slot="toast"][role="status"] [data-toast]')!;

    expect(toast.textContent).toBe('Added Playback stalls to the List. View item Queue');
    expect(toast.querySelector('.dismiss')!.getAttribute('aria-label')).toBe('Dismiss: Added Playback stalls');
    expect(text($('.title-bar [data-list-button]')), 'the board shows the new data').toBe('List21');
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

test('picking a new ticket closes the dialog and announces it, and one on the board already opens its item', async () => {
    await open();
    await settle(() => $<HTMLButtonElement>('[data-pane="pick"]')!.click());
    respond({ tickets: [{ number: 8, title: 'Seek stalls', url: 'u8' }], error: null });
    await searchFor('seek');

    const item = { ...sample.items[0]!, id: 'work-8', number: 8, title: 'Seek stalls' };

    respond({ item, created: true, error: null, board: { ...sample, items: [...sample.items, item] } });
    await settle(() => ticketButton(8).click());
    await settle(() => vi.advanceTimersByTime(50));
    expect(calls('/api/pick-ticket')).toEqual([['/api/pick-ticket', { repo: 'acme/api', number: 8 }]]);
    expect(dialog()).toBeNull();
    expect(text($('[data-slot="toast"][role="status"] [data-toast]'))).toBe(
        'Added #8 Seek stalls to the List. View item Queue',
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

test('a typed label is created on submit, is kept with the draft, and can be unticked', async () => {
    await labelSetup(['backend', 'docs']);
    await chooseOption(field('item-kind'), 'Bug');
    await enter(field('item-title'), 'Playback stalls');
    await openPicker();
    expect(search().placeholder).toBe('Filter or type a new label');
    await enter(search(), 'needs-design');
    expect(
        $$('[data-label-picker] p').some((p) => text(p) === 'Nothing matches.'),
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
