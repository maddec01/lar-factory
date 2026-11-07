import { onAzure, trackerCapabilities, writeAccessProblem, type RepositorySetup } from '@lar-factory/shared';
import {
    Button,
    buttonKind,
    FormSection,
    Input,
    InsetPanel,
    OptionSelect,
    SettingsGroups,
    Text,
} from '@lar-works/design-system';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { AccessList, AccessReason, accessRows } from './AccessList';
import { shownDrafts, useEditStore, type Drafts, type DraftSetting } from './EditStore';
import { EditVocabulary } from './EditVocabulary';
import { IssueDefaults } from './IssueDefaults';
import { LabelsSection } from './LabelsSection';
import { FieldRow } from '@/shared/settings/FieldRow';

const PROJECT_SETTINGS = [
    { id: 'role', label: 'What this Project does' },
    { id: 'itemSource', label: 'Work to read' },
    { id: 'createIssuesFromAddItem', label: 'Create issues from Add item' },
    { id: 'createIssuesFromRetro', label: 'Create issues from retro captures' },
    { id: 'writeRefinedSpec', label: 'Write the refined spec to the issue' },
    { id: 'vocabulary', label: 'Kinds and labels' },
    { id: 'labels', label: 'Labels' },
    { id: 'domainDocs', label: 'Glossary and decisions' },
    { id: 'glossary', label: 'Glossary path' },
    { id: 'adrs', label: 'ADR folder' },
    { id: 'skills', label: 'Project skills' },
    { id: 'access', label: 'Access' },
];

export function projectSettings(repo: string) {
    return PROJECT_SETTINGS.map((setting) => ({
        ...setting,
        label:
            setting.id === 'itemSource' && onAzure(repo)
                ? 'Team'
                : setting.id === 'labels'
                  ? trackerCapabilities(repo).heading
                  : setting.id === 'vocabulary'
                    ? `Kinds and ${trackerCapabilities(repo).heading.toLowerCase()}`
                    : setting.label,
    }));
}

export function ProjectPage({ setup }: { setup: RepositorySetup }) {
    const { repo } = setup;
    const {
        drafts: allDrafts,
        fieldErrors,
        issueDrafts,
        running,
        type,
        save,
        reset,
        recheck,
        issueDefault,
    } = useEditStore();
    const drafts = shownDrafts(setup, allDrafts[repo] ?? {});
    const errors = fieldErrors[repo] ?? {};
    const latest = useRef(setup);

    useLayoutEffect(() => {
        latest.current = setup;
    });
    useEffect(
        () => () => {
            // Unmounting on Close or navigation counts as leaving every text field.
            const store = useEditStore.getState();

            for (const key of ['role', 'itemSource', 'skills', 'domainDocs'] as DraftSetting[])
                void store.save(repo, key, latest.current);
        },
        [repo],
    );

    const recheckAccess = () => {
        void recheck(repo);
    };
    const docsProblem =
        writeAccessProblem(repo, 'push-branch', setup.access, { azureReadOnly: setup.azureReadOnly }) ??
        writeAccessProblem(repo, 'open-pr', setup.access, { azureReadOnly: setup.azureReadOnly });
    const text = (field: keyof Drafts, label: string, key: DraftSetting) => (
        <Input
            presentation="setting"
            aria-label={label}
            aria-invalid={!!errors[field]}
            aria-describedby={errors[field] ? `${field === 'team' ? 'itemSource' : field}-error` : undefined}
            value={drafts[field]}
            disabled={!!docsProblem && (field === 'glossary' || field === 'adrs')}
            onChange={(event) => type(repo, field, event.target.value)}
            onBlur={() => void save(repo, key, latest.current)}
            onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
            }}
        />
    );
    const resetButton = (key: DraftSetting) =>
        setup.sources[key] === 'local' && (
            <Button {...buttonKind('other')} onClick={() => void reset(repo, key)}>
                Reset
            </Button>
        );

    return (
        <SettingsGroups data-project-page={repo}>
            <FormSection presentation="dense" title="Project">
                <InsetPanel presentation="settings">
                    <FieldRow
                        id="role"
                        label="What this Project does"
                        help="Describe its purpose so agents know where to work."
                        error={errors.role}
                    >
                        {text('role', 'What this Project does', 'role')}
                        {resetButton('role')}
                    </FieldRow>
                </InsetPanel>
            </FormSection>
            <FormSection presentation="dense" title="Work">
                <InsetPanel presentation="settings">
                    <FieldRow
                        id="itemSource"
                        label={onAzure(repo) ? 'Team' : 'Work to read'}
                        error={errors.team ?? errors.itemSource}
                    >
                        {onAzure(repo) ? (
                            <>
                                {text('team', 'Team', 'itemSource')}
                                {resetButton('itemSource')}
                            </>
                        ) : (
                            <Text variant="caption" tone="muted">
                                This repository's GitHub issues.
                            </Text>
                        )}
                    </FieldRow>
                </InsetPanel>
                <IssueDefaults
                    setup={{ ...setup, ...issueDrafts[repo] }}
                    onChange={(key, on) => void issueDefault(repo, key, on)}
                    onRecheck={recheckAccess}
                    checking={running === 'recheck'}
                    errors={errors}
                />
            </FormSection>
            <EditVocabulary key={repo} setup={setup} />
            <LabelsSection key={repo} repo={repo} setup={setup} />
            <FormSection presentation="dense" title="Docs and skills">
                <InsetPanel presentation="settings">
                    <FieldRow
                        id="domainDocs"
                        label="Glossary and decisions"
                        help="Choose whether builds include domain docs in their PRs."
                        error={errors.domainDocs}
                        description={
                            docsProblem && (
                                <AccessReason
                                    repo={repo}
                                    reason={docsProblem}
                                    onRecheck={recheckAccess}
                                    checking={running === 'recheck'}
                                />
                            )
                        }
                    >
                        <OptionSelect
                            label="Domain docs"
                            presentation="setting"
                            writesOnPick
                            value={docsProblem ? 'off' : drafts.domainDocs}
                            disabled={!!docsProblem}
                            onChange={(value) => {
                                type(repo, 'domainDocs', value);
                                void save(repo, 'domainDocs', latest.current);
                            }}
                            options={[
                                { value: 'off', label: 'Off' },
                                { value: 'repository', label: 'Write in build PRs' },
                            ]}
                        />
                        {resetButton('domainDocs')}
                    </FieldRow>
                    {drafts.domainDocs === 'repository' && (
                        <>
                            <FieldRow id="glossary" label="Glossary path" error={errors.glossary}>
                                {text('glossary', 'Glossary path', 'domainDocs')}
                            </FieldRow>
                            <FieldRow id="adrs" label="ADR folder" error={errors.adrs}>
                                {text('adrs', 'ADR folder', 'domainDocs')}
                            </FieldRow>
                        </>
                    )}
                    <FieldRow
                        id="skills"
                        label="Project skills"
                        help="Coding guidance for builds. Separate them with commas."
                        error={errors.skills}
                    >
                        {text('skills', 'Project skills', 'skills')}
                        {resetButton('skills')}
                    </FieldRow>
                </InsetPanel>
            </FormSection>
            <FormSection presentation="dense" title="Access">
                <AccessList rows={accessRows(setup)} checking={running === 'recheck'} onRecheck={recheckAccess} />
                {errors.recheck && (
                    <Text variant="caption" tone="danger" role="alert">
                        {errors.recheck}
                    </Text>
                )}
            </FormSection>
        </SettingsGroups>
    );
}
