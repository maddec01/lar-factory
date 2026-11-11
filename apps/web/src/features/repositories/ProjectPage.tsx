// A Project's editable settings, tracker vocabulary, labels and access. A choice or a switch applies at once; typed text
// is a draft that Settings' footer saves (or Enter), and leaving with one unsaved asks first.

import { onAzure, writeAccessProblem, type RepositorySetup } from '@lar-factory/shared';
import {
    Alert,
    Button,
    Input,
    InsetPanel,
    OptionSelect,
    SettingsGroup,
    Stack,
    Text,
    useSettingsDraft,
} from '@lar-works/design-system';
import { useLayoutEffect, useRef } from 'react';

import { AccessList, AccessReason } from './AccessList';
import { shownDrafts, useEditStore, type Drafts, type DraftSetting } from './EditStore';
import { EditVocabulary } from './EditVocabulary';
import { IssueDefaults } from './IssueDefaults';
import { LabelsSection } from './LabelsSection';
import { accessRows } from './RepositoryAccess';
import { FieldRow } from '@/shared/settings/FieldRow';
import { buttonKind } from '@/ui/board';

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
    const typed = allDrafts[repo] ?? {};
    const drafts = shownDrafts(setup, typed);
    const savedText = shownDrafts(setup, {});
    const errors = fieldErrors[repo] ?? {};
    const latest = useRef(setup);

    useLayoutEffect(() => {
        latest.current = setup;
    });

    // The typed text fields that differ from what is saved; the domain docs choice applies at once.
    const changed = TEXT_FIELDS.filter((field) => field in typed && typed[field] !== savedText[field]);
    const { submit } = useSettingsDraft({
        dirty: changed.length > 0,
        save: async () => {
            const store = useEditStore.getState();

            for (const key of DRAFT_SETTINGS) await store.save(repo, key, latest.current);

            const failed = TEXT_FIELDS.map((field) => useEditStore.getState().fieldErrors[repo]?.[field]).find(Boolean);

            // The draft stays, with each reason beside its field.
            if (failed) throw new Error(failed);
        },
        reset: () => useEditStore.getState().discard(repo, TEXT_FIELDS),
        error: TEXT_FIELDS.map((field) => errors[field]).find(Boolean) ?? null,
    });

    const recheckAccess = () => {
        void recheck(repo);
    };
    const docsProblem =
        writeAccessProblem(repo, 'push-branch', setup.access, { azureReadOnly: setup.azureReadOnly }) ??
        writeAccessProblem(repo, 'open-pr', setup.access, { azureReadOnly: setup.azureReadOnly });
    const text = (field: keyof Drafts, label: string) => (
        <Input
            presentation="setting"
            aria-label={label}
            aria-invalid={!!errors[field]}
            aria-describedby={errors[field] ? `${field === 'team' ? 'itemSource' : field}-error` : undefined}
            value={drafts[field]}
            disabled={!!docsProblem && (field === 'glossary' || field === 'adrs')}
            onChange={(event) => type(repo, field, event.target.value)}
            onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
            }}
        />
    );
    const resetButton = (key: DraftSetting) =>
        setup.sources[key] === 'local' && (
            <Button {...buttonKind('other', { size: 'md' })} onClick={() => void reset(repo, key)}>
                Reset
            </Button>
        );

    return (
        <Stack space="page" data-project-page={repo}>
            <SettingsGroup title="Project">
                <FieldRow
                    id="role"
                    label="What this project does"
                    help="Describe its purpose so agents know where to work."
                    error={errors.role}
                >
                    {text('role', 'What this project does')}
                    {resetButton('role')}
                </FieldRow>
            </SettingsGroup>
            <SettingsGroup title="Work" panel={false}>
                <InsetPanel presentation="settings">
                    <FieldRow
                        id="itemSource"
                        label={onAzure(repo) ? 'Team' : 'Work to read'}
                        error={errors.team ?? errors.itemSource}
                    >
                        {onAzure(repo) ? (
                            <>
                                {text('team', 'Team')}
                                {resetButton('itemSource')}
                            </>
                        ) : (
                            <Text variant="caption" tone="muted">
                                This repository’s GitHub issues.
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
            </SettingsGroup>
            <EditVocabulary key={repo} setup={setup} />
            <LabelsSection key={repo} repo={repo} setup={setup} />
            <SettingsGroup title="Docs and skills">
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
                            {text('glossary', 'Glossary path')}
                        </FieldRow>
                        <FieldRow id="adrs" label="ADR folder" error={errors.adrs}>
                            {text('adrs', 'ADR folder')}
                        </FieldRow>
                    </>
                )}
                <FieldRow
                    id="skills"
                    label="Project skills"
                    help="Coding guidance for builds. Separate them with commas."
                    error={errors.skills}
                >
                    {text('skills', 'Project skills')}
                    {resetButton('skills')}
                </FieldRow>
            </SettingsGroup>
            <SettingsGroup
                title="Access"
                data-access-settings
                panel={false}
                action={
                    <Button {...buttonKind('other')} loading={running === 'recheck'} onClick={recheckAccess}>
                        Recheck access
                    </Button>
                }
                note={
                    errors.recheck && (
                        <Alert size="sm" tone="danger">
                            {errors.recheck}
                        </Alert>
                    )
                }
            >
                <AccessList rows={accessRows(setup)} checking={running === 'recheck'} />
            </SettingsGroup>
        </Stack>
    );
}

/** The text fields a draft holds until Settings' footer saves them. */
const TEXT_FIELDS: (keyof Drafts)[] = ['role', 'team', 'skills', 'glossary', 'adrs'];

/** The settings those fields make, saved in turn. */
const DRAFT_SETTINGS: DraftSetting[] = ['role', 'itemSource', 'skills', 'domainDocs'];
