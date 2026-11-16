import type { SetupDetection } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import type { Checkout } from '../t3/repository-project.ts';
import { type DetectReads, detectSetup } from './detect-setup.ts';

const WEB: Checkout = {
    id: 'web',
    title: 'lar-web',
    folder: '/Users/me/Developer/lar-web',
    origin: 'git@github.com:maddec01/lar-web.git',
};
const AZURE: Checkout = {
    id: 'shop',
    title: 'shop',
    folder: '/Users/me/shop',
    origin: 'git@ssh.dev.azure.com:v3/contoso/Retail/shop',
};

/** Reads that find `files`, by path with their text, on the default branch, and the other facts as `parts` say. */
function reads(files: Record<string, string> = {}, parts: Partial<DetectReads> = {}): DetectReads {
    return {
        checkouts: async () => [WEB, AZURE],
        tree: async () => ({
            tree: {
                sha: 'tree0',
                files: new Map(Object.keys(files).map((path) => [path, { mode: '100644', sha: path }])),
            },
        }),
        github: async () => ({ push: true, triage: true, issues: true, tokenWrites: true }),
        azurePush: async () => true,
        teams: async () => ['Retail Team', 'Platform'],
        ...parts,
    };
}

const detect = async (
    files?: Record<string, string>,
    parts?: Partial<DetectReads>,
    input: Record<string, unknown> = {},
) => {
    const answer = await detectSetup({ repo: 'maddec01/lar-web', projectId: 'web', ...input }, reads(files, parts));

    return (answer as { detection: SetupDetection }).detection;
};

test('detection reads doc and skill paths without reading factory configuration or instructions', async () => {
    const found = reads({
        'GLOSSARY.md': '',
        'docs/adr/one.md': '',
        '.agents/skills/local/SKILL.md': '',
        'AGENTS.md': '',
        '.lar-factory.json': '',
    });
    const tree = found.tree;

    found.tree = async (repo) => ({
        ...(await tree(repo)),
        read: async () => {
            throw new Error('No file content should be read');
        },
    });

    const result = (await detectSetup({ repo: 'maddec01/lar-web', projectId: 'web' }, found)) as {
        detection: SetupDetection;
    };

    assert.deepEqual(result.detection.domainDocs, {
        found: { kind: 'repository', glossary: 'GLOSSARY.md', adrs: 'docs/adr' },
    });
    assert.deepEqual(result.detection.projectSkills, { found: ['local'] });
    assert.ok(!('factoryFiles' in result.detection));
    assert.ok(!('sharedConfig' in result.detection));
    assert.ok(Object.values(result.detection.access).every((access) => access === 'allowed'));
});

test("an Azure DevOps repository detects its teams' boards and push access, with ticket access unverified", async () => {
    const repo = 'contoso/Retail/shop';
    const detection = await detect({}, {}, { repo, projectId: 'shop' });

    assert.deepEqual(
        [detection.provider, detection.checkout, detection.itemSources],
        [
            'Azure DevOps',
            { found: '/Users/me/shop' },
            {
                found: [
                    { kind: 'azure-board', team: 'Retail Team' },
                    { kind: 'azure-board', team: 'Platform' },
                ],
            },
        ],
    );
    assert.deepEqual(detection.access, {
        'push-branch': 'allowed',
        'open-pr': 'unverified',
        'publish-ticket': 'unverified',
        'edit-ticket': 'unverified',
        'tag-ticket': 'unverified',
        'manage-labels': 'unverified',
        'comment-ticket': 'unverified',
        'type-ticket': 'unverified',
        'relate-ticket': 'unverified',
    });

    const refused = await detect(
        {},
        {
            azurePush: async () => false,
            teams: async () => {
                throw new Error('TF400813: not authorized');
            },
        },
        { repo, projectId: 'shop' },
    );

    assert.deepEqual(
        [refused.access['push-branch'], refused.access['open-pr'], refused.itemSources],
        [
            'refused',
            'unverified',
            { refused: "Can't read contoso/Retail/shop's teams with az: TF400813: not authorized" },
        ],
    );
});

test('a push-capable user with an unverified token gets no positive write access', async () => {
    const detection = await detect({}, { github: async () => ({ push: true, triage: true, issues: true }) });

    assert.ok(Object.values(detection.access).every((access) => access === 'unverified'));
    assert.deepEqual(detection.itemSources, { found: [{ kind: 'issues' }] });
});
