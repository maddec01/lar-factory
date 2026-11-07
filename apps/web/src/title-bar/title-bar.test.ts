// The board's title bar, in the board app and in a browser, past the traffic lights: on the left the brand and the
// status strip, the Refreshed time and the counters; beside the actions the board search's field; on the right List,
// Add item, a divider, Update while there's an update, and Settings. Above the missing-t3 notice only the brand and
// Settings.

import { clock, type InstallSnapshot } from '@lar-factory/shared';
import { beforeEach, expect, test, vi } from 'vite-plus/test';

import {
    $,
    $$,
    NOW,
    fresh,
    fullScreen,
    mountPage,
    push,
    sample,
    settle,
    stubApp,
    text,
    toolChecks,
    updatesOff,
} from '../../test/support.ts';

// jsdom has no ResizeObserver, which the design system's Modal's scroll fade observes with.
beforeEach(() =>
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    ),
);

const titleBar = () => $<HTMLElement>('.title-bar')!;
const field = () => titleBar().querySelector<HTMLButtonElement>('[data-search-field]')!;
const refreshed = () => titleBar().querySelector<HTMLElement>('.refreshed')!;
const dot = () => refreshed().querySelector<HTMLElement>('[data-dot]')!;
const ping = () => refreshed().querySelector('[data-ping]');
const readAgo = (ago: number) => ({ ...sample, error: null, fetchedAt: new Date(NOW - ago).toISOString() });
const isAmber = (el: Element) => el.classList.contains('bg-amber-500');
const isGreen = (el: Element) => el.classList.contains('bg-success');
const tooltip = async () => {
    await settle(() => refreshed().focus());
    await settle(() => vi.advanceTimersByTime(1000));

    // Radix repeats the tooltip, hidden, as the trigger's description; this reads the one shown.
    return $$('[data-radix-popper-content-wrapper] [data-line]')
        .filter((line) => !line.closest('[role="tooltip"]'))
        .map(text);
};

/** The title bar's controls, left to right, by name. */
const CONTROLS = {
    brand: '.brand',
    refreshed: '.refreshed',
    counters: '.counters',
    search: '[data-search-field]',
    list: '.list-button',
    'add item': '.add-item',
    divider: '.app-divider',
    update: '.update-button',
    settings: '.open-settings',
} as const;
const controls = () =>
    [...titleBar().querySelectorAll(Object.values(CONTROLS).join(', '))].map(
        (el) => Object.entries(CONTROLS).find(([, selector]) => el.matches(selector))![0],
    );
const inset = () => titleBar().className.split(' ').includes('pl-[74px]');

test('the title bar holds the brand, the status strip, the search field, then List, Add item, a divider, Update and Settings', async () => {
    stubApp({
        getUpdateState: vi.fn(async () => ({
            ...updatesOff,
            enabled: true,
            status: 'available' as const,
            availableVersion: '1.1.0',
            message: null,
        })),
    });
    await mountPage();
    expect(controls()).toEqual([
        'brand',
        'refreshed',
        'counters',
        'search',
        'list',
        'add item',
        'divider',
        'update',
        'settings',
    ]);

    const header = titleBar().querySelector('header')!;
    const [, , middle, right] = [...header.children];
    const strip = middle!.querySelector('.status-strip')!;

    expect(
        [...strip.children].map((el) =>
            el.matches('.refreshed') ? 'refreshed' : el.matches('.counters') ? 'counters' : 'rule',
        ),
        'the strip holds Refreshed, a rule, then the counters',
    ).toEqual(['refreshed', 'rule', 'counters']);
    expect(right!.firstElementChild!.matches('.list-button'), 'the right opens on List').toBe(true);
    expect(text(titleBar()), 'no "for T3 Code" tag').not.toContain('T3 Code');
    expect(header.className.split(' ')).toContain('h-13');
});

// jsdom lays nothing out, so this checks the classes: the strip keeps its width right after the brand, and the field's
// wrapper takes the room up to 26rem at the far end of the title zone, beside the actions.
test('the counters sit after the brand, and the field takes up to 26rem beside the actions', async () => {
    await mountPage();

    const strip = titleBar().querySelector('.status-strip')!;

    expect(
        strip.className.split(' ').filter((c) => /absolute|translate/.test(c)),
        'the strip is not centred',
    ).toEqual([]);
    expect(strip.previousElementSibling, 'the strip opens the title zone').toBeNull();
    expect(strip.parentElement!.className.split(' '), 'the title zone fills the room up to List').toContain('flex-1');

    const wrapper = field().parentElement!;

    expect(strip.nextElementSibling).toBe(wrapper);
    expect(wrapper.className.split(' ')).toEqual(
        expect.arrayContaining(['ml-auto', 'flex-1', 'min-w-0', 'max-w-[26rem]']),
    );
});

// The kinds' sheet sizes each to 28 px (buttons/button-kinds.css); inside the strip the title bar's sheet makes them 24.
test("Add item is the bar's Main action and every other control an App control; Settings is icon-only", async () => {
    stubApp({
        getUpdateState: vi.fn(async () => ({
            ...updatesOff,
            enabled: true,
            status: 'available' as const,
            availableVersion: '1.1.0',
            message: null,
        })),
    });
    await mountPage();

    const kindOf = (selector: string) => titleBar().querySelector(selector)!.getAttribute('data-kind');

    expect(kindOf('.add-item')).toBe('main');
    for (const selector of ['.list-button', '.update-button', '.open-settings'])
        expect(kindOf(selector), selector).toBe('control');
    expect([...titleBar().querySelectorAll('.counters button')].map((b) => b.getAttribute('data-kind'))).toEqual(
        Array(5).fill('control'),
    );

    const settings = titleBar().querySelector('.open-settings')!;

    expect([settings.getAttribute('data-icon-only'), settings.getAttribute('aria-label'), text(settings)]).toEqual([
        'large',
        'Settings',
        '',
    ]);
    expect(settings.className.split(' '), 'its icon takes the text colour').toContain('text-base-content');
    expect(refreshed().className.split(' '), "Refreshed is 24 px, as the strip's counters").toContain('h-6');
});

test("in a browser, where nothing updates, there's no update pill", async () => {
    await mountPage();
    expect(controls()).toEqual(['brand', 'refreshed', 'counters', 'search', 'list', 'add item', 'divider', 'settings']);
});

test(`the brand reads "Lar Factory": the design system's BrandMark, then Factory on its baseline`, async () => {
    await mountPage();

    const brand = $('.title-bar .brand')!;

    expect(text(brand)).toBe('arFactory');
    expect(brand.className.split(' ')).toEqual(expect.arrayContaining(['inline-flex', 'items-baseline']));

    const [mark, factory] = [...brand.children];

    expect(mark!.className.split(' ')).toContain('lar-brand-mark');
    expect(mark!.querySelector('svg')).not.toBeNull();
    expect(text(factory)).toBe('Factory');
});

test('above the missing-t3 notice the bar holds only the brand and Settings, which opens', async () => {
    stubApp({
        getInstallState: vi.fn(async (): Promise<InstallSnapshot> => ({
            installs: true,
            installed: true,
            version: '0.2.0',
            running: null,
            discovery: 'not-running',
            instances: [],
            drift: [],
            replaced: [],
            conflicts: [],
            blocked: [],
            targets: [
                {
                    kind: 'claude',
                    path: '~/.claude/skills',
                    paths: ['~/.claude/skills'],
                    locked: false,
                    active: true,
                    finished: true,
                    instances: [],
                    skills: [],
                },
            ],
        })),
    });
    await mountPage({ ...sample, tools: toolChecks({ t3: { result: 'missing' } }) });
    expect(controls()).toEqual(['brand', 'settings']);
    await settle(() => $<HTMLButtonElement>('.title-bar .open-settings')!.click());
    await settle(() =>
        $$<HTMLButtonElement>('.settings-nav button')
            .find((b) => text(b) === 'Skills')!
            .click(),
    );
    await settle(() => vi.advanceTimersByTime(50));
    expect($('[role="dialog"] .settings-body')!.textContent, 'Settings opens over the notice').toContain('~/.claude');
    expect($('.tool-missing')).not.toBeNull();
});

test("in a browser too, the missing-t3 notice's bar holds only the brand and Settings", async () => {
    await mountPage({ ...sample, tools: toolChecks({ t3: { result: 'missing' } }) });
    expect(controls()).toEqual(['brand', 'settings']);
});

test('Add item opens the Add item flow, and ⌘N does too', async () => {
    await mountPage();

    const add = titleBar().querySelector<HTMLButtonElement>('.add-item')!;

    expect([text(add), add.getAttribute('aria-keyshortcuts')]).toEqual(['Add item', 'Meta+N']);
    await settle(() => add.click());
    expect($('#add-item-dialog')!.hidden).toBe(false);
});

test("in a browser, grey stand-ins hold the traffic lights' place, with the bar starting past them as in the Mac app", async () => {
    await mountPage();

    const lights = $$('.traffic-lights > span');

    expect(lights).toHaveLength(3);
    expect(
        lights.every((s) => s.className.split(' ').includes('bg-(--traffic-stand-in)') && !s.style.background),
        'one grey token, no colours',
    ).toBe(true);
    expect(inset()).toBe(true);
});

test('in the Mac app, macOS draws the traffic lights and the bar starts past them', async () => {
    stubApp({});
    await mountPage();
    expect($('.traffic-lights')).toBeNull();
    expect(inset()).toBe(true);
});

test("in the Mac app's full screen, where macOS hides the traffic lights, the bar keeps only its own padding", async () => {
    const window = fullScreen(true);

    stubApp(window.bridge);
    await mountPage();
    expect(inset()).toBe(false);
    await window.set(false);
    expect(inset()).toBe(true);
    await window.set(true);
    expect(inset()).toBe(false);
});

test('outside the Mac app, full screen leaves the bar where it is', async () => {
    stubApp({ ...fullScreen(true).bridge, platform: 'linux' });
    await mountPage();
    expect(inset()).toBe(true);
});

test('the bar drags the window, but none of its controls do', async () => {
    await mountPage();
    expect(titleBar().className.split(' ')).toEqual(
        expect.arrayContaining([
            '[-webkit-app-region:drag]',
            '[&_:is(button,a,[tabindex])]:[-webkit-app-region:no-drag]',
        ]),
    );
    expect(refreshed().tabIndex, 'the time is a tab stop, so it is no-drag too').toBe(0);
});

test('screen readers skip the brand; the page keeps one h1, for screen readers only', async () => {
    await mountPage();
    expect($('.brand')!.getAttribute('aria-hidden')).toBe('true');
    expect(titleBar().closest('[aria-hidden="true"]')).toBeNull();
    expect($$('h1').map((h) => [h.className, text(h)])).toEqual([['sr-only', 'Lar Factory']]);
});

test('the title bar shows when the data was last read', async () => {
    await mountPage();
    expect(text(refreshed())).toBe('Stale · 20m ago');
});

test("the List modal's Scope board scopes the title bar too", async () => {
    await mountPage();
    await settle(() => $<HTMLButtonElement>('.title-bar .list-button')!.click());
    await settle(() =>
        $$<HTMLButtonElement>('[data-list-modal] nav button')
            .find((b) => b.querySelector('.name')?.textContent === 'lar-apple')!
            .click(),
    );
    await settle(() => $<HTMLButtonElement>('[data-list-modal] .scope-board')!.click());
    expect(field().getAttribute('aria-label')).toBe('Search, filtered by lar-apple');
});

test('the time shows a focus ring on keyboard focus', async () => {
    await mountPage();
    expect(refreshed().className.split(' ')).toContain('focus-visible:ring-2');
    expect(refreshed().tabIndex).toBe(0);
});

test("the time counts up each second, between the board's 15 s ticks, in muted 12 px digits of fixed width", async () => {
    await mountPage(fresh());
    await settle(() => vi.advanceTimersByTime(12_000));
    expect(text(refreshed())).toBe('12s ago');
    await settle(() => vi.advanceTimersByTime(1_000));
    expect(text(refreshed())).toBe('13s ago');
    expect(refreshed().className.split(' ')).toEqual(
        expect.arrayContaining(['text-xs', 'tabular-nums', 'text-base-700']),
    );
});

test('a fresh board has a green dot; stale turns the dot amber and says Stale, with the text still muted', async () => {
    await mountPage(fresh());
    expect(isGreen(dot())).toBe(true);
    expect(text(refreshed())).toBe('0s ago');
    await push(readAgo(4 * 86_400_000));
    expect(text(refreshed())).toBe('Stale · 4d ago');
    expect(isAmber(dot())).toBe(true);
    expect(refreshed().className.split(' ')).toContain('text-base-700');
    await push(readAgo(20 * 60_000 + 1));
    expect(text(refreshed()), 'no error, but not read for 3 intervals').toBe('Stale · 20m ago');
});

test("a failed read turns the dot amber too, and the sample's old failed read says Stale", async () => {
    await mountPage();
    expect([text(refreshed()), isAmber(dot())]).toEqual(['Stale · 20m ago', true]);
    await push({ ...fresh(), error: 'gh api graphql failed' });
    expect([text(refreshed()), isAmber(dot())]).toEqual(['Stale · 0s ago', true]);
});

test('before the first read it says so behind a grey dot, or an amber one if that read failed', async () => {
    await mountPage({ ...sample, fetchedAt: null, error: null });
    expect(text(refreshed())).toBe('Not read yet');
    expect([isAmber(dot()), isGreen(dot())]).toEqual([false, false]);
    await push({ ...sample, fetchedAt: null, error: 'gh api graphql failed' });
    expect(text(refreshed())).toBe('Not read yet');
    expect(isAmber(dot())).toBe(true);
});

test('while some repositories still read, it shows Loading Projects behind a grey dot, never Stale, until every read lands', async () => {
    const reading = (waiting: string[]) => ({
        ...fresh(),
        firstRead: { step: 'items' as const, running: [], waiting, settled: false },
    });

    await mountPage(reading(['maddec01/lar-server', 'maddec01/lar-apple']));
    expect(text(refreshed())).toBe('Loading Projects');
    expect([isAmber(dot()), isGreen(dot())]).toEqual([false, false]);
    await push(reading(['maddec01/lar-apple']));
    expect(text(refreshed())).toBe('Loading Projects');
    await push(fresh());
    expect(text(refreshed())).toBe('0s ago');
    expect(isGreen(dot())).toBe(true);
});

test('the tooltip gives the exact time and when reads happen', async () => {
    await mountPage(readAgo(11_000));

    const read = clock(new Date(NOW - 11_000).toISOString(), undefined);

    expect(read).toMatch(/^\d\d:\d\d$/);
    expect(await tooltip()).toEqual([
        `Updated 12s ago · ${read}`,
        'Checks GitHub for changes every 5s, reads everything every 45s',
    ]);
});

test('the Refreshed clock stops while the window is hidden and catches up immediately when shown', async () => {
    await mountPage(fresh());

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    await settle(() => document.dispatchEvent(new Event('visibilitychange')));
    await settle(() => vi.advanceTimersByTime(12_000));
    expect(text(refreshed())).toBe('0s ago');
    hidden.mockReturnValue(false);
    await settle(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(text(refreshed())).toBe('12s ago');
    await settle(() => vi.advanceTimersByTime(1_000));
    expect(text(refreshed())).toBe('13s ago');
});

test('the tooltip names a failed read by its first line', async () => {
    await mountPage();

    const read = clock(sample.fetchedAt!, undefined);

    expect(await tooltip()).toEqual([
        `Updated 20m ago · ${read}`,
        'Last read failed: gh api graphql failed: error connecting to api.github.com',
    ]);
});

test('before the first read the tooltip says so', async () => {
    await mountPage({ ...sample, fetchedAt: null, error: null });
    expect(await tooltip()).toEqual(['Not read yet', 'Checks GitHub for changes every 5s, reads everything every 45s']);
    await push({ ...sample, fetchedAt: null, error: 'boom\nmore' });
    expect(await tooltip()).toEqual(['Not read yet', 'Last read failed: boom']);
});

test('the dot pings once for each newer read, never on page load, in stale or when older data arrives', async () => {
    await mountPage(readAgo(10_000));
    expect(ping(), 'not on page load').toBeNull();
    await settle(() => vi.advanceTimersByTime(5_000));
    expect(ping()).toBeNull();
    await push(fresh());

    const first = ping();

    expect(first).not.toBeNull();
    expect(first!.className.split(' ')).toEqual(
        expect.arrayContaining(['motion-safe:animate-[refreshed-ping_1.2s_ease-out_forwards]']),
    );
    await push(fresh());
    expect(ping(), 'the same read again does not replay it').toBe(first);
    await settle(() => vi.advanceTimersByTime(2_000));
    await push(readAgo(1_000));
    expect(ping(), 'an older read does not ping').toBe(first);
    await settle(() => vi.advanceTimersByTime(3_000));
    await push({ ...readAgo(-5_000), items: [] });
    expect(ping(), 'a newer read replays it').not.toBe(first);
});

test('the first read of a page that had none pings, a failed read does not', async () => {
    await mountPage({ ...sample, fetchedAt: null, error: null });
    await push(fresh());
    expect(ping(), 'a first read is newer than none').not.toBeNull();
    await push({ ...fresh(), error: 'boom' });
    expect(ping()).toBeNull();
});

// jsdom lays nothing out, so this checks the classes behind the fold. The List and Add item labels fold at 70rem, with
// Update or without it, before Spend folds at 66rem. The counters never show their labels.
test('the bar folds by its own width instead of squeezing: the counters keep theirs, and labels go before controls', async () => {
    stubApp({
        getUpdateState: vi.fn(async () => ({
            ...updatesOff,
            enabled: true,
            status: 'downloaded' as const,
            availableVersion: '1.1.0',
            downloadedVersion: '1.1.0',
            message: null,
        })),
    });
    await mountPage();

    const classes = (el: Element | null) => el!.className.split(' ');

    expect(
        classes(titleBar().querySelector('header')),
        "the design system's TitleBar is the container the fold reads",
    ).toContain('@container');

    const counters = titleBar().querySelector('.counters')!;

    expect(classes(counters)).toContain('shrink-0');
    expect(classes(counters), 'a size container would have no width of its own').not.toContain('@container');
    expect(classes(counters.parentElement), 'its slot never shrinks below it').not.toContain('min-w-0');
    for (const [button, label] of [
        ['.list-button', 'List'],
        ['.add-item', 'Add item'],
    ] as const) {
        const span = [...titleBar().querySelectorAll(`${button} span`)].find((s) => text(s) === label);

        expect(classes(span ?? null), `${label}'s label stays for screen readers`).toContain('@max-[70rem]:sr-only');
    }
    expect(text(counters), 'the counters show no labels').not.toMatch(/need you|shaping|building|shipped|spend/);
    expect(classes(refreshed().querySelector('time')!.parentElement)).toContain('@max-[48rem]:sr-only');
    expect(classes(refreshed()), 'Refreshed keeps its width while its text changes').toContain('@min-[48rem]:min-w-30');
});
