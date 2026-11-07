import { onAzure, trackerCapabilities, writeAccessProblem, type RepositorySetup } from '@lar-factory/shared';
import { FormSelect } from '@lar-factory/ui/form-select';
import { Button, Input } from '@lar-works/design-system';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { AccessList, AccessReason, accessRows } from './AccessList';
import { shownDrafts, useEditStore, type Drafts, type DraftSetting } from './EditStore';
import { IssueDefaults } from './IssueDefaults';
import { LabelsSection } from './LabelsSection';
import { EditVocabulary } from './VocabularyEditor';
import { kind } from '@/shared/ui/buttons/ButtonKinds';
import { FIELD_GROUP, FieldRow } from '@/shared/ui/setting-rows/FieldRow';

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
            className="w-64 max-w-full"
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
            <Button {...kind('other')} onClick={() => void reset(repo, key)}>
                Reset
            </Button>
        );

    return (
        <div data-project-page={repo} className="grid min-w-0 gap-7">
            <section className="grid min-w-0 gap-3">
                <h3 className="m-0 text-[13px] font-semibold">Project</h3>
                <div className={FIELD_GROUP}>
                    <FieldRow
                        id="role"
                        label="What this Project does"
                        help="Describe its purpose so agents know where to work."
                        error={errors.role}
                    >
                        {text('role', 'What this Project does', 'role')}
                        {resetButton('role')}
                    </FieldRow>
                </div>
            </section>
            <section className="grid min-w-0 gap-3">
                <h3 className="m-0 text-[13px] font-semibold">Work</h3>
                <div className={FIELD_GROUP}>
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
                            <span className="text-xs text-(--muted-foreground)">This repository's GitHub issues.</span>
                        )}
                    </FieldRow>
                </div>
                <IssueDefaults
                    setup={{ ...setup, ...issueDrafts[repo] }}
                    onChange={(key, on) => void issueDefault(repo, key, on)}
                    onRecheck={recheckAccess}
                    checking={running === 'recheck'}
                    errors={errors}
                />
            </section>
            <EditVocabulary key={repo} setup={setup} />
            <LabelsSection key={repo} repo={repo} setup={setup} />
            <section className="grid min-w-0 gap-3">
                <h3 className="m-0 text-[13px] font-semibold">Docs and skills</h3>
                <div className={FIELD_GROUP}>
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
                        <span className="w-44 max-w-full">
                            <FormSelect
                                aria-label="Domain docs"
                                writesOnPick
                                value={docsProblem ? 'off' : drafts.domainDocs}
                                disabled={!!docsProblem}
                                onChange={(value) => {
                                    type(repo, 'domainDocs', value);
                                    void save(repo, 'domainDocs', latest.current);
                                }}
                                choices={[
                                    { value: 'off', name: 'Off' },
                                    { value: 'repository', name: 'Write in build PRs' },
                                ]}
                            />
                        </span>
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
                </div>
            </section>
            <section className="grid min-w-0 gap-3">
                <h3 className="m-0 text-[13px] font-semibold">Access</h3>
                <AccessList rows={accessRows(setup)} checking={running === 'recheck'} onRecheck={recheckAccess} />
                {errors.recheck && (
                    <p role="alert" className="m-0 text-xs text-(--error-foreground)">
                        {errors.recheck}
                    </p>
                )}
            </section>
        </div>
    );
}
