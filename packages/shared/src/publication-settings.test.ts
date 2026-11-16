import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

import { discoverVocabulary, type VocabularyReads } from './publication-settings.ts';

const available: VocabularyReads = {
    github: async (path) =>
        path.endsWith('/issue-types')
            ? [{ name: 'Bug' }, { name: 'Task' }]
            : path.includes('/labels')
              ? [{ name: 'backend' }]
              : { owner: { type: 'Organization' } },
    azure: async (_repo, resource) => ({
        value: resource === 'workitemtypes' ? [{ name: 'User Story' }] : [{ name: 'backend' }],
    }),
};

test('provider discovery returns only detected terms and distinguishes an empty list', async () => {
    expect(await discoverVocabulary('org/repo', available)).toEqual({
        provider: 'github',
        types: { state: 'available', choices: ['Bug', 'Task'] },
        labels: { state: 'available', choices: ['backend'] },
    });
    expect(await discoverVocabulary('org/project/repo', available)).toEqual({
        provider: 'azure',
        types: { state: 'available', choices: ['User Story'] },
        labels: { state: 'available', choices: ['backend'] },
    });
    expect(
        (await discoverVocabulary('org/project/repo', { ...available, azure: async () => ({ value: [] }) })).types,
    ).toEqual({ state: 'available', choices: [] });
});

test('the command reads the board settings while it is closed and detects mapping and destination changes', async (t) => {
    const { writeListFile, setVocabularyOverride, setOverride } = await import('./repository-settings.ts');
    const { readPublicationSettings } = await import('./publication-settings.ts');
    const dir = await mkdtemp(join(tmpdir(), 'publication settings '));

    t.onTestFinished(() => rm(dir, { recursive: true, force: true }));

    const repo = 'org/project/repo';

    writeListFile(dir, { repositories: [{ repo }] });
    setVocabularyOverride(repo, 'build', { type: 'User Story', labels: ['backend'] }, dir);

    const first = await readPublicationSettings(repo, { dir, reads: available });

    expect(first.setup.vocabularySources.build).toBe('local');
    setVocabularyOverride(repo, 'build', { type: null, labels: [] }, dir);

    const local = await readPublicationSettings(repo, { dir, reads: available });

    expect(local.setup.vocabulary.build).toEqual({ type: null, labels: [] });
    expect(local.setup.vocabularySources.build).toBe('local');
    expect(local.snapshot).not.toBe(first.snapshot);
    setVocabularyOverride(repo, 'build', undefined, dir);
    expect((await readPublicationSettings(repo, { dir, reads: available })).setup.vocabulary.build.type).toBeNull();
    setOverride(repo, 'itemSource', { kind: 'azure-board', team: 'Platform' }, dir);
    expect((await readPublicationSettings(repo, { dir, reads: available })).snapshot).not.toBe(first.snapshot);
});

test('legacy settings load default preferences and private domain docs as off', async (t) => {
    const { writeListFile, readRepositorySetups, setOverride, replaceAccess } =
        await import('./repository-settings.ts');
    const { effectiveIssueSettings } = await import('./write-access.ts');
    const dir = mkdtempSync(join(tmpdir(), 'issue-defaults-'));

    t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeListFile(dir, {
        repositories: [{ repo: 'org/repo', settings: { overrides: { domainDocs: { kind: 'private' } } } }],
    });

    const read = () => readRepositorySetups(dir)[0]!;

    expect(read()).toMatchObject({
        domainDocs: { kind: 'off' },
        createIssuesFromAddItem: true,
        createIssuesFromRetro: true,
        writeRefinedSpec: true,
    });
    expect(effectiveIssueSettings(read())).toMatchObject({
        createIssuesFromAddItem: false,
        createIssuesFromRetro: false,
        writeRefinedSpec: false,
    });
    replaceAccess('org/repo', { 'publish-ticket': 'allowed', 'edit-ticket': 'allowed' }, dir);
    expect(effectiveIssueSettings(read())).toEqual({
        createIssuesFromAddItem: true,
        createIssuesFromRetro: true,
        writeRefinedSpec: true,
        createReason: null,
        specReason: null,
    });
    replaceAccess('org/repo', { 'publish-ticket': 'refused', 'edit-ticket': 'allowed' }, dir);
    expect(effectiveIssueSettings(read())).toMatchObject({
        createIssuesFromRetro: false,
        writeRefinedSpec: true,
        createReason: 'Access to publish-ticket was refused. Recheck access in Settings.',
    });
    replaceAccess('org/repo', { 'publish-ticket': 'allowed', 'edit-ticket': 'allowed' }, dir);
    setOverride('org/repo', 'createIssuesFromAddItem', false, dir);
    expect(effectiveIssueSettings(read()).createIssuesFromAddItem).toBe(false);
    expect(effectiveIssueSettings({ ...read(), repo: 'org/project/repo' }, { azureReadOnly: true })).toMatchObject({
        createIssuesFromRetro: false,
        writeRefinedSpec: false,
        createReason: 'Azure DevOps is read-only in this test session.',
        specReason: 'Azure DevOps is read-only in this test session.',
    });
});

test('explicit label creation requires verified access and reuses existing labels', async () => {
    const { saveVocabularyLabels } = await import('./publication-settings.ts');
    const discovery = await discoverVocabulary('org/repo', available);
    const created: string[] = [];
    const create = async (_repo: string, name: string) => {
        created.push(name);

        return name;
    };

    await expect(saveVocabularyLabels('org/repo', ['new'], discovery, {}, create)).rejects.toThrow(
        'Access to manage-labels isn’t checked yet. Sign in to GitHub with repository write access to confirm permissions. Recheck access in Settings.',
    );
    expect(created).toEqual([]);
    await expect(
        saveVocabularyLabels('org/repo', ['new'], discovery, { 'tag-ticket': 'allowed' }, create),
    ).rejects.toThrow('Access to manage-labels isn’t checked yet');
    expect(created).toEqual([]);
    expect(
        await saveVocabularyLabels('org/repo', ['BACKEND', 'new'], discovery, { 'manage-labels': 'allowed' }, create),
    ).toEqual(['backend', 'new']);
    expect(created).toEqual(['new']);
});
