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

it('chooses the same linked structure for the settled three-repository input on every run', () => {
    const scope = parseBriefScope({
        ...base,
        repositories: ['example/a', 'example/b', 'example/c'],
        openDecisions: [],
    });

    expect(chooseStructure(scope)).toEqual(chooseStructure(JSON.parse(JSON.stringify(scope))));
    expect(chooseStructure(scope)).toMatchObject({
        structure: 'linked',
        reason: expect.stringContaining('one build per repository'),
    });
});

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

it('refuses to infer structure from a legacy confirmation or invalid repository roster', () => {
    expect(() => chooseStructure(parseBriefScope(base))).toThrow(/explicit amendment/);
    for (const repositories of [[], ['invalid'], ['example/a', 'Example/A']])
        expect(() => parseBriefScope({ ...base, repositories, openDecisions: [] })).toThrow(/Scope needs/);
    expect(() => parseBriefScope({ ...base, repositories: ['example/a'] })).toThrow(/Scope needs/);
    expect(() => parseBriefScope({ ...base, repositories: ['example/a'], openDecisions: 'none' })).toThrow(
        /Scope needs/,
    );
});
