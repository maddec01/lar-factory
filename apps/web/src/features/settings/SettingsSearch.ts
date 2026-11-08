// Filter both sections and rows, leaving the saved section untouched while searching.
import type { RepoConfig } from '@lar-factory/shared';

import type { Page } from './SettingsModel';

export function filterSettingsPages(
    pages: Page[],
    query: string,
    repos: readonly RepoConfig[],
    projectFields: (repo: string) => readonly { label: string }[],
): Page[] {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

    if (!words.length) return pages;

    const matches = (...values: (string | undefined)[]) =>
        words.every((word) => values.join(' ').toLowerCase().includes(word));

    return pages.flatMap((page) => {
        if (matches(page.label, page.keywords)) return [page];

        const groups = page.groups.flatMap((group) => {
            if (matches(group.title)) return [group];

            const rows = group.rows.filter((row) =>
                matches(row.title, row.keywords, typeof row.description === 'string' ? row.description : undefined),
            );

            return rows.length ? [{ ...group, rows }] : [];
        });
        const projectMatch =
            page.id === 'projects' &&
            repos.some(
                (repo) =>
                    matches(repo.repo) ||
                    (!!repo.setup && projectFields(repo.repo).some((field) => matches(field.label))),
            );

        return groups.length ? [{ ...page, groups }] : projectMatch ? [page] : [];
    });
}
