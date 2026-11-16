import type { BoardData } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, mountPage, push, sample, settle, stream, toolChecks } from '@/test/PageTest';

const healthy: BoardData = { ...sample, tools: toolChecks(), repositoryConfigProblems: [], itemSourceProblems: [] };
const warning = (key: string) => $(`[data-warning="${key}"]`)?.closest<HTMLElement>('[data-slot="notice"]') ?? null;
const closeWarning = (key: string) => settle(() => warning(key)!.querySelector<HTMLButtonElement>('.dismiss')!.click());

const conditions: { key: string; failed: Partial<BoardData>; changed: Partial<BoardData> }[] = [
    {
        key: 'gh',
        failed: { tools: toolChecks({ gh: { result: 'missing', fix: 'brew install gh' } }) },
        changed: { tools: toolChecks({ gh: { result: 'logged-out', fix: 'gh auth login' } }) },
    },
];

test.each(conditions)(
    '$key stays closed through refreshes and changed details, then shows after clearing and recurring',
    async ({ key, failed, changed }) => {
        await mountPage({ ...healthy, ...failed });

        const entry = warning(key)!;

        expect(entry.dataset.slot).toBe('notice');
        expect(entry.querySelector('.dismiss')!.getAttribute('aria-label')).toMatch(/^Dismiss: .+/);
        await settle(() => stream().onopen!());
        await settle(() => vi.advanceTimersByTime(60_000));
        expect(warning(key)).toBe(entry);
        await push({ ...healthy, ...changed });
        expect(warning(key), 'changed details preserve the notification and its age').toBe(entry);
        await push(healthy);
        expect(warning(key)).toBeNull();
        await push({ ...healthy, ...failed });
        await closeWarning(key);
        expect(warning(key)).toBeNull();
        await push({ ...healthy, ...failed });
        await push({ ...healthy, ...changed });
        expect(warning(key)).toBeNull();
        await push(healthy);
        await push({ ...healthy, ...changed });
        expect(warning(key)).not.toBeNull();
    },
);
