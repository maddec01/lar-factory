import { expect, it } from 'vite-plus/test';

import { parseBriefScope } from './brief-scope.ts';
import { chooseStructure } from './choose-structure.ts';

const base = {
    files: [],
    tests: [],
    behaviour: ['Deliver the greeting.'],
    excluded: [],
    size: null,
    verify: { required: false, visibleUi: null },
};

it('uses concept decision parts while cross-repository product choices are open', () => {
    const scope = parseBriefScope({
        ...base,
        repositories: ['example/a', 'example/b'],
        openDecisions: ['Choose the public contract.'],
    });

    expect(chooseStructure(scope).structure).toBe('concept');
    expect(chooseStructure({ ...scope, openDecisions: [] }).structure).toBe('linked');
    expect(chooseStructure({ ...scope, repositories: ['example/a'] }).structure).toBe('single');
});
