import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi, test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import { checkouts } from '../../test/repo-support.ts';
import { projectsDb } from '../../test/stats-db.ts';
import { azureRepo, repositoryProjectReads } from './repository-project.ts';
import { liveProjects } from './t3-db.ts';

const AZURE = [
    'https://contoso@dev.azure.com/contoso/Fabrikam/_git/api',
    'git@ssh.dev.azure.com:v3/contoso/Fabrikam/api',
    'https://contoso.visualstudio.com/Fabrikam/_git/api',
    'contoso@vs-ssh.visualstudio.com:v3/contoso/Fabrikam/api',
];
const GITHUB = [
    'https://github.com/maddec01/lar-factory.git',
    'git@github.com:maddec01/lar-factory.git',
    'ssh://git@github.com/maddec01/lar-factory',
];

/** A home with checkouts of these origins under ~/Developer/lar, each a T3 project, and the env that reads them. */
function t3Home(t: TestContext, origins: Record<string, string>): NodeJS.ProcessEnv {
    const home = mkdtempSync(join(tmpdir(), 'lar-azure-home-'));

    t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
    checkouts(home, origins);

    const db = projectsDb(
        t,
        Object.keys(origins).map((name) => ({ id: name, root: join(home, 'Developer/lar', name) })),
    );

    return { ...process.env, HOME: home, T3_STATE_DB: db };
}

test('every Azure DevOps origin form names its organization, project and repository', () => {
    for (const url of AZURE) assert.equal(azureRepo(url), 'contoso/Fabrikam/api', url);
    assert.equal(azureRepo('https://dev.azure.com/contoso/Fabrikam/_git/api'), 'contoso/Fabrikam/api');
    assert.equal(
        azureRepo('https://contoso.visualstudio.com/DefaultCollection/Fabrikam/_git/api'),
        'contoso/Fabrikam/api',
    );
    assert.equal(
        azureRepo('https://dev.azure.com/contoso/Fabrikam%20Fiber/_git/lar%20api'),
        'contoso/Fabrikam%20Fiber/lar%20api',
    );
    // A repository named after its project may leave the project out.
    assert.equal(azureRepo('https://dev.azure.com/contoso/_git/Fabrikam'), 'contoso/Fabrikam/Fabrikam');
    for (const url of [...GITHUB, 'https://dev.azure.com/contoso', 'https://dev.azure.com/contoso/Fabrikam/_wiki/x'])
        assert.equal(azureRepo(url), null, url);
});

test('Start finds the checkout of a GitHub or an Azure DevOps repository', async (t) => {
    const env = t3Home(t, { 'lar-factory': GITHUB[0]!, api: AZURE[0]! });
    const repo = (name: string) => ({ repo: name, role: 'server', labels: [] });

    assert.deepEqual(
        (
            await repositoryProjectReads(
                [repo('maddec01/lar-factory'), repo('contoso/fabrikam/api'), repo('contoso/fabrikam/web')],
                env,
            )
        ).repositoryProjects,
        {
            'maddec01/lar-factory': null,
            'contoso/fabrikam/api': null,
            'contoso/fabrikam/web': 'No T3 project is a checkout of contoso/fabrikam/web; add the checkout in T3 Code',
        },
    );
});

vi.mock('./repository-project-discovery.ts', () => ({
    repositoryProjects: async (env: NodeJS.ProcessEnv) => {
        try {
            return {
                availability: 'available',
                observation: {
                    observedAt: '2026-10-31T00:00:00Z',
                    projects: liveProjects(env.T3_STATE_DB!, env.HOME ?? '').map((p) => ({
                        id: p.id,
                        title: p.title,
                        workspaceRoot: p.folder,
                    })),
                },
            };
        } catch {
            return { availability: 'unavailable' };
        }
    },
}));
