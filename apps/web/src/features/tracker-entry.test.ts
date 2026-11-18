// The screens that name a ticket's tracker take its name, icon, wording and link from the tracker's entry in the shared
// package, so a new tracker adds one entry instead of changing each screen.

import { readFileSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';

/** Each screen's file, and whether it may still ask if a project is on Azure DevOps for something other than naming it. */
const SCREENS: [string, boolean][] = [
    ['item-dialog/ItemSummary.tsx', false],
    ['item-dialog/ItemDescription.tsx', false],
    ['item-dialog/ConceptParts.tsx', false],
    ['item-dialog/CreateTicket.tsx', false],
    ['items/ItemParts.tsx', false],
    // Slice parts hide the GitHub mark unless an Azure DevOps project exists.
    ['items/SourceIcon.tsx', true],
    ['line/RowIdentity.tsx', false],
    ['add-item/IssueFields.tsx', false],
    ['settings/ProjectRows.tsx', false],
];

/** A tracker named in code, or its icon chosen there. */
const NAMES = /GitHub|Azure DevOps|ICON\.(github|azure)/;

test.each(SCREENS)('%s names no tracker itself', (file, asksAzure) => {
    const code = readFileSync(new URL(file, import.meta.url), 'utf8').replaceAll(
        /\/\*[\s\S]*?\*\/|(^|\s)\/\/.*$/gm,
        '',
    );

    expect(code).not.toMatch(asksAzure ? NAMES : new RegExp(`${NAMES.source}|onAzure`));
});
