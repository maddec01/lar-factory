// The warning for each onboarded repository whose items the latest read left off, such as one reading through a logged-out az.

import { expect, test } from 'vite-plus/test';

import { $$, warningText, mountPage, push, sample } from '@/test/PageTest';

const problems = [
    { repo: 'contoso/Fabrikam/orders', problem: 'az is logged out.', fix: 'az login' },
    {
        repo: 'contoso/Fabrikam/portal',
        problem:
            'Team Web has no current iteration in contoso/Fabrikam. Give the team a sprint whose dates cover today in its project settings.',
    },
];

test('each repository whose items can’t be read gets a warning naming it as the list modal does, why and its fix, which clears once it reads', async () => {
    await mountPage({ ...sample, itemSourceProblems: problems });

    const warnings = () => $$('[data-slot="notice"]');

    expect(warnings().map(warningText)).toEqual([
        [
            'orders’s items couldn’t be refreshed.',
            'az is logged out. Run az login Copy in a terminal. The board reads it again on each refresh.',
        ],
        [
            'portal’s items couldn’t be refreshed.',
            'Team Web has no current iteration in contoso/Fabrikam. Give the team a sprint whose dates cover today in its project settings. ' +
                'The board reads it again on each refresh.',
        ],
    ]);
    expect(warnings()[0]!.closest('[data-board-notices]')).not.toBeNull();

    await push({ ...sample, itemSourceProblems: [] });
    expect(warnings()).toEqual([]);
});
