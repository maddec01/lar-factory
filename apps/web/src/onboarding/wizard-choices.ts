// Onboarding checks access before choosing local settings.
import {
    sameRepo,
    shownRepo,
    type Detected,
    type DomainDocLocation,
    type OnboardingChoices,
    type RepoConfig,
    type RepositoryItemSource,
    type SetupDetection,
} from '@lar-factory/shared';

export const STEP_TITLES = { project: 'Project', access: 'Access', work: 'Work and docs' } as const;
export type StepId = keyof typeof STEP_TITLES;
export const isStep = (id: string): id is StepId => Object.hasOwn(STEP_TITLES, id);

const found = <T>(fact: Detected<T>): T | null => ('found' in fact ? fact.found : null);

export const stepsOf = (): StepId[] => ['project', 'access', 'work'];
export interface Answers {
    itemSource: RepositoryItemSource | null;
    role: string;
    domainDocs: DomainDocLocation;
    skills: string[];
    structureSync: boolean;
    createIssuesFromAddItem: boolean;
    createIssuesFromRetro: boolean;
    writeRefinedSpec: boolean;
}
export interface Option<T> {
    id: string;
    value: T;
    title: string;
    cost: string;
}
export function sourceOptions(detection: SetupDetection): Option<RepositoryItemSource>[] {
    return (found(detection.itemSources) ?? []).map((source) => ({
        id: source.kind === 'issues' ? 'issues' : source.team,
        value: source,
        title: source.kind === 'issues' ? 'GitHub issues' : source.team,
        cost:
            source.kind === 'issues'
                ? 'Open issues appear in the list.'
                : 'Backlog and current sprint, with each item once.',
    }));
}
export const repositoryDocs = (detection: SetupDetection): DomainDocLocation => {
    const docs = found(detection.domainDocs);

    return docs?.kind === 'repository' ? docs : { kind: 'repository', glossary: 'GLOSSARY.md', adrs: 'docs/adr' };
};
export function skillOptions(detection: SetupDetection): Option<string>[] {
    return (found(detection.projectSkills) ?? []).map((name) => ({
        id: name,
        value: name,
        title: name,
        cost: 'Coding guidance for builds.',
    }));
}
export function connectionOptions(repo: string, repos: readonly RepoConfig[]): Option<string>[] {
    return repos
        .filter((r) => !sameRepo(r.repo, repo))
        .map((r) => ({ id: r.repo, value: r.repo, title: shownRepo(r.repo), cost: r.role }));
}
export function connectionsOf(
    repo: string,
    _role: string,
    choices: OnboardingChoices,
    repos: readonly RepoConfig[],
): string[] {
    return connectionOptions(repo, repos)
        .filter((o) => choices.connections?.some((r) => sameRepo(r, o.value)))
        .map((o) => o.value);
}

function defaultsOf(detection: SetupDetection): Answers {
    return {
        itemSource: sourceOptions(detection)[0]?.value ?? null,
        role: '',
        createIssuesFromAddItem: true,
        createIssuesFromRetro: true,
        writeRefinedSpec: true,
        domainDocs: found(detection.domainDocs) ?? { kind: 'off' },
        skills: [],
        structureSync: true,
    };
}

export function answersOf(detection: SetupDetection, choices: OnboardingChoices): Answers {
    const answers = { ...defaultsOf(detection), ...choices };

    return { ...answers, domainDocs: answers.domainDocs.kind === 'repository' ? answers.domainDocs : { kind: 'off' } };
}
export function answerProblem(step: StepId, answers: Answers): string | null {
    return step === 'work' && !answers.itemSource ? 'Choose a team to continue.' : null;
}
