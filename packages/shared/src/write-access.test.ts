import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

import { writeAccessProblem } from './write-access.ts';

test('writes require verified access and respect Azure safety', () => {
    expect(writeAccessProblem('org/repo', 'publish-ticket', {})).toContain('isn’t checked');
    expect(writeAccessProblem('org/repo', 'publish-ticket', { 'publish-ticket': 'refused' })).toContain('refused');
    expect(writeAccessProblem('org/repo', 'publish-ticket', { 'publish-ticket': 'allowed' })).toBeNull();
    expect(
        writeAccessProblem(
            'org/project/repo',
            'publish-ticket',
            { 'publish-ticket': 'allowed' },
            { azureReadOnly: true },
        ),
    ).toContain('read-only');
});

test('legacy consent loads without granting access and disappears on resave', async (t) => {
    const { writeListFile, readRepositorySetups, setStructureSync } = await import('./repository-settings.ts');
    const { REPOSITORY_LIST_FILE } = await import('./data-dir.ts');
    const dir = mkdtempSync(join(tmpdir(), 'legacy-access-'));

    t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeListFile(dir, { repositories: [{ repo: 'org/repo', settings: { consent: ['publish-ticket'] } }] });
    expect(readRepositorySetups(dir)[0]).not.toHaveProperty('consent');
    setStructureSync('org/repo', true, dir);
    expect(readFileSync(join(dir, REPOSITORY_LIST_FILE), 'utf8')).not.toContain('consent');
});

test('repository identities don’t change write authorization', () => {
    for (const repo of ['another-org/Project%20Name/another-repository']) {
        expect(
            writeAccessProblem(repo, 'publish-ticket', { 'publish-ticket': 'allowed' }, { azureReadOnly: false }),
        ).toBeNull();
        expect(
            writeAccessProblem(repo, 'publish-ticket', { 'publish-ticket': 'refused' }, { azureReadOnly: false }),
        ).toContain('refused');
        expect(writeAccessProblem(repo, 'publish-ticket', {}, { azureReadOnly: false })).not.toBeNull();
    }
});
