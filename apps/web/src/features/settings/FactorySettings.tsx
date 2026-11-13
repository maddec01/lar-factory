import {
    FACTORY_ROLES,
    duplicateReviewer,
    THREAD_KINDS,
    parseFactorySettings,
    type FactoryRole,
    type FactorySettings,
    type FactorySettingsState,
    type ThreadKind,
} from '@lar-factory/shared/factory-settings';
import { useSettingsDraft } from '@lar-works/design-system';
import { useEffect, useState } from 'react';

import { instructionText, prepareFactoryDraft } from './FactoryDraft';
import { FactoryExecution } from './FactoryExecution';
import { FactoryReviewer } from './FactoryReviewer';
import { readFactorySettings, saveFactorySettings } from '@/services/settings/settings.service';
import {
    FactoryAction,
    FactoryModelTable,
    FactorySettingsGroup,
    FactorySettingsLayout,
    FactorySettingsNotice,
} from '@/ui/board';

const labels: Record<ThreadKind | (typeof FACTORY_ROLES)[number], string> = {
    shaping: 'Shaping',
    concept: 'Concept',
    decision: 'Decision',
    build: 'Build',
    explore: 'Explore',
    diagnose: 'Diagnose',
    research: 'Research',
    prototype: 'Prototype',
    checks: 'Checks',
    'domain-docs': 'Domain docs',
    fixer: 'Fixer',
    planner: 'Planner',
    implementer: 'Implementer',
    approver: 'Approver',
    'ci-fixer': 'CI fixer',
    doubt: 'Doubt',
};

function FactoryEditor({ initial }: { initial: FactorySettingsState }) {
    const [saved, setSaved] = useState(initial);
    const [draft, setDraft] = useState<FactorySettings>(initial.settings);
    const [texts, setTexts] = useState<Record<string, string>>({});
    const [editingId, setEditingId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const dirty = JSON.stringify(draft) !== JSON.stringify(saved.settings) || Object.keys(texts).length > 0;
    const reset = () => {
        setDraft(saved.settings);
        setTexts({});
        setError(null);
    };
    const save = async () => {
        setSaving(true);
        setError(null);

        try {
            const next = parseFactorySettings(prepareFactoryDraft(draft, texts));
            const result = await saveFactorySettings(next, saved.revision);

            setSaved({ ...saved, ...result, problem: undefined });
            setDraft(result.settings);
            setTexts({});
        } catch (problem) {
            const message = problem instanceof Error ? problem.message : 'Could not save settings.';

            setError(message);
            throw problem;
        } finally {
            setSaving(false);
        }
    };

    useSettingsDraft({ dirty, save, reset, error });

    return (
        <FactorySettingsLayout busy={saving} problem={error ?? saved.problem}>
            <FactorySettingsGroup
                title="Reviewers"
                description="Code always runs by default. Security, UI and Performance run on trigger. Doubt and the approver remain required."
                action={
                    <FactoryAction
                        onClick={() => {
                            const id = `custom-${crypto.randomUUID()}`;

                            setDraft({
                                ...draft,
                                reviewers: [
                                    ...draft.reviewers,
                                    {
                                        id,
                                        name: 'New reviewer',
                                        mode: { kind: 'always' },
                                        instructions: { kind: 'revision', revision: 1 },
                                        revisions: [],
                                    },
                                ],
                            });
                            setTexts({ ...texts, [id]: '' });
                            setEditingId(id);
                        }}
                    >
                        Add reviewer
                    </FactoryAction>
                }
            >
                {draft.reviewers.map((reviewer) => (
                    <FactoryReviewer
                        key={reviewer.id}
                        reviewer={reviewer}
                        editing={editingId === reviewer.id}
                        onEdit={() => setEditingId(editingId === reviewer.id ? null : reviewer.id)}
                        text={texts[reviewer.id] ?? instructionText(reviewer, saved.defaults)}
                        onChange={(next) =>
                            setDraft({
                                ...draft,
                                reviewers: draft.reviewers.map((entry) => (entry.id === next.id ? next : entry)),
                            })
                        }
                        onText={(text) => setTexts({ ...texts, [reviewer.id]: text })}
                        onDuplicate={() => {
                            const id = `custom-${crypto.randomUUID()}`;

                            setDraft(
                                duplicateReviewer(draft, reviewer.id, id, instructionText(reviewer, saved.defaults)),
                            );
                            setEditingId(id);
                        }}
                        onRemove={() => {
                            const roleKey: FactoryRole = `reviewer:${reviewer.id}`;
                            const { [roleKey]: _role, ...roles } = draft.roles;
                            const { [reviewer.id]: _text, ...rest } = texts;

                            setDraft({
                                ...draft,
                                roles,
                                reviewers: draft.reviewers.filter((entry) => entry.id !== reviewer.id),
                            });
                            setTexts(rest);
                            setEditingId(null);
                        }}
                    />
                ))}
            </FactorySettingsGroup>
            <FactorySettingsGroup
                title="Thread defaults"
                description="Choose what each kind of thread uses. Project default in T3 preserves today's model and effort choices."
            >
                <FactoryModelTable label="Thread defaults" rowHeader="Thread kind">
                    {THREAD_KINDS.map((kind) => (
                        <FactoryExecution
                            key={kind}
                            label={labels[kind]}
                            value={draft.threadKinds[kind] ?? {}}
                            groups={saved.models}
                            inherited="Project default in T3"
                            onChange={(value) =>
                                setDraft({ ...draft, threadKinds: { ...draft.threadKinds, [kind]: value } })
                            }
                        />
                    ))}
                </FactoryModelTable>
            </FactorySettingsGroup>
            <FactorySettingsGroup
                title="Roles"
                description="Roles use their thread's choices unless overridden here. Saved changes apply to future runs."
            >
                <FactoryModelTable label="Roles" rowHeader="Role">
                    {[
                        ...(['planner', 'implementer'] as const).map((value) => ({ value, label: labels[value] })),
                        ...draft.reviewers.map((entry) => ({
                            value: `reviewer:${entry.id}` as FactoryRole,
                            label: `${entry.name} reviewer`,
                        })),
                        ...(['approver', 'ci-fixer', 'doubt'] as const).map((value) => ({
                            value,
                            label: labels[value],
                        })),
                        ...FACTORY_ROLES.filter(
                            (value) => !['planner', 'implementer', 'approver', 'ci-fixer', 'doubt'].includes(value),
                        ).map((value) => ({ value, label: labels[value] })),
                    ].map(({ value: role, label }) => (
                        <FactoryExecution
                            key={role}
                            label={label}
                            value={draft.roles[role] ?? {}}
                            groups={saved.models}
                            inherited="Same as its thread"
                            onChange={(value) => setDraft({ ...draft, roles: { ...draft.roles, [role]: value } })}
                        />
                    ))}
                </FactoryModelTable>
            </FactorySettingsGroup>
        </FactorySettingsLayout>
    );
}

export function FactorySettingsSection() {
    const [state, setState] = useState<FactorySettingsState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let active = true;

        void readFactorySettings().then(
            (value) => {
                if (active) setState(value);
            },
            (problem: unknown) => {
                if (active) setError(problem instanceof Error ? problem.message : 'Could not load settings.');
            },
        );

        return () => {
            active = false;
        };
    }, [attempt]);

    return state ? (
        <FactoryEditor initial={state} />
    ) : (
        <FactorySettingsNotice
            retry={
                error
                    ? () => {
                          setError(null);
                          setAttempt(attempt + 1);
                      }
                    : undefined
            }
        >
            {error ?? 'Loading reviewer and model settings…'}
        </FactorySettingsNotice>
    );
}
