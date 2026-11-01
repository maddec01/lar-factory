// Onboarding chooses a source and local settings, then checks access once.
import { structureSyncOperations, sameRepo, shownRepo, type Detected, type DomainDocLocation, type OnboardingChoices,
  type RepoConfig, type RepositoryItemSource, type RepositoryOperation, type SetupDetection } from '@lar-factory/shared';

export const STEP_TITLES = { project: 'Repository', work: 'Work and docs', access: 'Access and add' } as const;
export type StepId = keyof typeof STEP_TITLES;
export const isStep = (id: string): id is StepId => Object.hasOwn(STEP_TITLES, id);
export const found = <T>(fact: Detected<T>): T | null => 'found' in fact ? fact.found : null;
export const stepsOf = (): StepId[] => ['project', 'work', 'access'];
export interface Answers {
  itemSource: RepositoryItemSource | null;
  role: string;
  domainDocs: DomainDocLocation;
  skills: string[];
  structureSync: boolean;
}
export interface Option<T> { id: string; value: T; title: string; cost: string }
export function sourceOptions(detection: SetupDetection): Option<RepositoryItemSource>[] {
  return (found(detection.itemSources) ?? []).map((source) => ({ id: source.kind === 'issues' ? 'issues' : source.team,
    value: source, title: source.kind === 'issues' ? 'GitHub issues' : source.team,
    cost: source.kind === 'issues' ? 'Open issues appear in the list.' : 'Backlog and current sprint, with each item once.' }));
}
export const repositoryDocs = (detection: SetupDetection): DomainDocLocation => {
  const docs = found(detection.domainDocs);
  return docs?.kind === 'repository' ? docs : { kind: 'repository', glossary: 'GLOSSARY.md', adrs: 'docs/adr' };
};
export function skillOptions(detection: SetupDetection): Option<string>[] {
  return (found(detection.projectSkills) ?? []).map((name) => ({ id: name, value: name, title: name, cost: 'Coding guidance for builds.' }));
}
export function connectionOptions(repo: string, repos: readonly RepoConfig[]): Option<string>[] {
  return repos.filter((r) => !sameRepo(r.repo, repo)).map((r) => ({ id: r.repo, value: r.repo, title: shownRepo(r.repo), cost: r.role }));
}
export function connectionsOf(repo: string, _role: string, choices: OnboardingChoices, repos: readonly RepoConfig[]): string[] {
  return connectionOptions(repo, repos).filter((o) => choices.connections?.some((r) => sameRepo(r, o.value))).map((o) => o.value);
}
function defaultsOf(detection: SetupDetection): Answers {
  return { itemSource: sourceOptions(detection)[0]?.value ?? null, role: '',
    domainDocs: found(detection.domainDocs) ?? { kind: 'off' }, skills: [], structureSync: true };
}
export const answersOf = (detection: SetupDetection, choices: OnboardingChoices): Answers => ({ ...defaultsOf(detection), ...choices });
export function answerProblem(step: StepId, answers: Answers): string | null {
  return step === 'work' && !answers.itemSource ? 'Choose a team to continue.' : null;
}
export const missingSyncAccess = (detection: SetupDetection): RepositoryOperation[] => structureSyncOperations(detection.repo).filter((op) => detection.access[op] !== 'allowed');
export function operationTitle(op: RepositoryOperation, detection: Pick<SetupDetection, 'provider'>): string {
  const issue = detection.provider === 'GitHub' ? 'issues' : 'work items';
  return ({ 'push-branch': 'Push branches', 'open-pr': 'Open pull requests', 'publish-ticket': `Create ${issue}`,
    'edit-ticket': `Edit ${issue}`, 'comment-ticket': 'Post comments', 'tag-ticket': 'Set labels or tags', 'type-ticket': 'Set item types', 'relate-ticket': 'Link items' })[op];
}
