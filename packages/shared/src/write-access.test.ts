import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

import { newLabelProblem, writeAccessProblem } from './write-access.ts';

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
    for (const repo of [
        'owner/project',
        'other-owner/other-project',
        'organization/project/repository',
        'another-org/Project%20Name/another-repository',
    ]) {
        expect(
            writeAccessProblem(repo, 'publish-ticket', { 'publish-ticket': 'allowed' }, { azureReadOnly: false }),
        ).toBeNull();
        expect(
            writeAccessProblem(repo, 'publish-ticket', { 'publish-ticket': 'refused' }, { azureReadOnly: false }),
        ).toContain('refused');
        expect(writeAccessProblem(repo, 'publish-ticket', {}, { azureReadOnly: false })).not.toBeNull();
    }
});

test('a new label needs label management, and on Azure stays unavailable with its reason even then', () => {
    expect(newLabelProblem('team/app', { 'manage-labels': 'allowed' })).toBeNull();
    expect(newLabelProblem('team/app', { 'tag-ticket': 'allowed' })).toContain(
        'Access to manage-labels isn’t checked yet',
    );
    expect(newLabelProblem('org/project/app', { 'manage-labels': 'allowed' })).toContain(
        'Azure DevOps has no way to create a tag on its own',
    );
    expect(newLabelProblem('org/project/app', { 'manage-labels': 'allowed' }, { azureReadOnly: true })).toBe(
        'Azure DevOps is read-only in this test session.',
    );
});
