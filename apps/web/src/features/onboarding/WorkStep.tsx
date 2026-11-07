// Onboarding's work step: where the Project's work comes from and how it is set up.

import { writeAccessProblem, type SetupDetection } from '@lar-factory/shared';
import {
    Button,
    buttonKind,
    ButtonRow,
    Checkbox,
    Disclosure,
    Input,
    InsetPanel,
    OptionSelect,
    SetupStep,
    Text,
} from '@lar-works/design-system';

import { KindMapping } from './KindMapping';
import {
    answersOf,
    connectionOptions,
    connectionsOf,
    repositoryDocs,
    skillOptions,
    sourceOptions,
} from './WizardChoices';
import { useWizardStore, type Run } from './WizardStore';
import { AccessReason, accessExplanation, IssueDefaults } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';
import { FieldRow } from '@/shared/settings/FieldRow';
import { Switch } from '@/shared/settings/SettingControls';

export function WorkStep({ run, detection }: { run: Run; detection: SetupDetection }) {
    const { choose, detect } = useWizardStore();
    const repos = useBoardStore((s) => s.data.repos);
    const answers = answersOf(detection, run.choices);
    const sources = sourceOptions(detection);
    const connections = connectionOptions(run.repo!, repos);
    const selected = connectionsOf(run.repo!, answers.role, run.choices, repos);
    const skills = skillOptions(detection);
    const issueSetup = { ...detection, ...answers };
    const docsProblem =
        writeAccessProblem(detection.repo, 'push-branch', detection.access, {
            azureReadOnly: detection.azureReadOnly,
        }) ??
        writeAccessProblem(detection.repo, 'open-pr', detection.access, { azureReadOnly: detection.azureReadOnly });
    const recheck = () => {
        void detect();
    };

    return (
        <SetupStep data-work-step presentation="form">
            <InsetPanel presentation="settings">
                <FieldRow
                    label="Show in the list"
                    description={
                        !sources.length
                            ? 'refused' in detection.itemSources
                                ? detection.itemSources.refused
                                : 'No teams found. Add a team in Azure DevOps, then recheck access.'
                            : undefined
                    }
                >
                    {detection.provider === 'GitHub' ? (
                        <Text as="span" variant="caption">
                            GitHub issues
                        </Text>
                    ) : (
                        <OptionSelect
                            presentation="setting"
                            label="Team"
                            placeholder="Choose a team"
                            value={answers.itemSource?.kind === 'azure-board' ? answers.itemSource.team : ''}
                            onChange={(team) => choose({ itemSource: { kind: 'azure-board', team } })}
                            options={sources.map((source) => ({ value: source.id, label: source.title }))}
                        />
                    )}
                </FieldRow>
                <FieldRow
                    id="domainDocs"
                    label="Write glossary and decisions in build PRs"
                    help="Builds include new domain terms and decisions for review."
                    description={
                        docsProblem && <AccessReason repo={detection.repo} reason={docsProblem} onRecheck={recheck} />
                    }
                >
                    <Switch
                        label="Write glossary and decisions in build PRs"
                        description={docsProblem ? accessExplanation(detection.repo, docsProblem) : undefined}
                        on={answers.domainDocs.kind === 'repository' && !docsProblem}
                        disabled={!!docsProblem}
                        onChange={(on) => choose({ domainDocs: on ? repositoryDocs(detection) : { kind: 'off' } })}
                    />
                </FieldRow>
            </InsetPanel>
            <IssueDefaults setup={issueSetup} onChange={(key, value) => choose({ [key]: value })} onRecheck={recheck} />
            <KindMapping key={run.repo} run={run} detection={detection} />
            <Disclosure presentation="group" label="Optional settings">
                <InsetPanel presentation="settings">
                    <FieldRow label="What this Project does" help="Helps agents place work across Projects.">
                        <Input
                            presentation="setting"
                            aria-label="What this Project does"
                            placeholder="API used by the mobile app"
                            value={answers.role}
                            onChange={(event) => choose({ role: event.target.value })}
                        />
                    </FieldRow>
                    {connections.length > 0 && (
                        <FieldRow label="Related Projects">
                            {connections.map((option) => (
                                <Checkbox
                                    key={option.id}
                                    label={option.title}
                                    checked={selected.includes(option.value)}
                                    onChange={() =>
                                        choose({
                                            connections: selected.includes(option.value)
                                                ? selected.filter((repo) => repo !== option.value)
                                                : [...selected, option.value],
                                        })
                                    }
                                />
                            ))}
                        </FieldRow>
                    )}
                    {skills.length > 0 && (
                        <FieldRow label="Project skills" help="Coding guidance for builds.">
                            {skills.map((option) => (
                                <Checkbox
                                    key={option.id}
                                    label={option.title}
                                    checked={answers.skills.includes(option.value)}
                                    onChange={() =>
                                        choose({
                                            skills: answers.skills.includes(option.value)
                                                ? answers.skills.filter((skill) => skill !== option.value)
                                                : [...answers.skills, option.value],
                                        })
                                    }
                                />
                            ))}
                        </FieldRow>
                    )}
                </InsetPanel>
            </Disclosure>
            <ButtonRow>
                <Button {...buttonKind('other')} onClick={recheck}>
                    Recheck access
                </Button>
            </ButtonRow>
        </SetupStep>
    );
}
