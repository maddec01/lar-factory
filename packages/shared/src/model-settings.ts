// Project settings and onboarding contracts.

import { onAzure } from './domain.ts';
import type { EffectiveVocabulary, VocabularyMapping, VocabularySources } from './vocabulary.ts';

/** The colors T3 lets a chosen project icon use. */
export const PROJECT_ICON_COLORS = [
    'gray',
    'red',
    'orange',
    'amber',
    'yellow',
    'lime',
    'green',
    'emerald',
    'teal',
    'cyan',
    'sky',
    'blue',
    'indigo',
    'violet',
    'purple',
    'fuchsia',
    'pink',
    'rose',
] as const;

export type ProjectIconColor = (typeof PROJECT_ICON_COLORS)[number];

/** The icon someone chose for a project in T3. */
export type ChosenProjectIcon =
    | { kind: 'lucide'; name: string; color: ProjectIconColor }
    | { kind: 'emoji'; emoji: string }
    | { kind: 'monogram'; text: string; color: ProjectIconColor };

/** A repository's icon: a favicon names the board's image by project and content revision, and no T3 path or URL reaches the page. */
export type ProjectIcon = { kind: 'favicon'; projectId: string; revision: string } | ChosenProjectIcon;

/** The service that hosts a repository, from its origin's host. */
export const PROVIDERS = ['GitHub', 'Azure DevOps'] as const;

export type Provider = (typeof PROVIDERS)[number];

/**
 * Where a repository's items come from: its own GitHub issues, or an Azure DevOps team's
 * backlog and current sprint together in the repository's project.
 */
export type RepositoryItemSource = { kind: 'issues' } | { kind: 'azure-board'; team: string };

/** Where a repository's glossary and ADRs go: its own files at these paths, or disabled. */
export type DomainDocLocation = { kind: 'off' } | { kind: 'repository'; glossary: string; adrs: string };

/**
 * Settings saved on this machine. Credentials stay with the provider's CLI.
 */
export interface SharedRepositorySettings {
    /** Repository role: what this repository is to the others. */
    role?: string;
    itemSource?: RepositoryItemSource;
    labels?: string[];
    domainDocs?: DomainDocLocation;
    /** The project skills the user selected as coding guidance for builds. */
    skills?: string[];
    vocabulary?: VocabularyMapping;
    createIssuesFromAddItem?: boolean;
    createIssuesFromRetro?: boolean;
    writeRefinedSpec?: boolean;
}

/** Settings editable on this machine. */
export const SHARED_SETTINGS = [
    'role',
    'itemSource',
    'labels',
    'domainDocs',
    'skills',
    'vocabulary',
    'createIssuesFromAddItem',
    'createIssuesFromRetro',
    'writeRefinedSpec',
] as const satisfies readonly (keyof SharedRepositorySettings)[];

export type SharedSetting = (typeof SHARED_SETTINGS)[number];

/** Whether a value was set on this machine or uses the factory default. */
export type SettingSource = 'local' | 'default';

/** The repository writes the factory may need, each with its own verified credential access. */
export const REPOSITORY_OPERATIONS = [
    'push-branch',
    'open-pr',
    'publish-ticket',
    'edit-ticket',
    'tag-ticket',
    'manage-labels',
    'comment-ticket',
    'type-ticket',
    'relate-ticket',
] as const;

export type RepositoryOperation = (typeof REPOSITORY_OPERATIONS)[number];

/** GitHub discovers immutable structure comments through a label; Azure uses revision-checked descriptions. */
export function structureSyncOperations(repo: string): readonly RepositoryOperation[] {
    return onAzure(repo)
        ? ['publish-ticket', 'edit-ticket', 'comment-ticket']
        : ['publish-ticket', 'comment-ticket', 'tag-ticket'];
}

/** What the user's credentials allow for an operation, as last found; one not needed since the last check stays unverified. */
export type OperationAccess = 'unverified' | 'allowed' | 'refused';

/**
 * One repository's local settings, with factory defaults for values the user has not set.
 */
export interface RepositorySetup {
    repo: string;
    /** The server session's Azure write restriction, never a saved preference. */
    azureReadOnly?: boolean;
    /** Save concepts and relationships on the tracker for recovery on another machine. */
    structureSync: boolean;
    createIssuesFromAddItem?: boolean;
    createIssuesFromRetro?: boolean;
    writeRefinedSpec?: boolean;
    /** The T3 project its threads start in, once onboarding picked one. */
    projectId?: string;
    role: string;
    /** Null for an Azure DevOps repository whose team no setting names yet. */
    itemSource: RepositoryItemSource | null;
    labels: string[];
    domainDocs: DomainDocLocation;
    skills: string[];
    vocabulary: EffectiveVocabulary;
    vocabularySources: VocabularySources;
    access: Record<RepositoryOperation, OperationAccess>;
    /** Where each setting's value comes from. */
    sources: Record<SharedSetting, SettingSource>;
    /** The other repositories the user connected it to, on this Mac only; the board's reads always fill it. */
    connections?: string[];
}

/** Repository values used by item sources. */
export interface RepositoryConfigAnswers extends SharedRepositorySettings {
    itemSource: RepositoryItemSource;
    role: string;
    /** Its custom labels: the file's `labels`, or those the Labels step picked. */
    labels: string[];
}

/**
 * What the setup step has answered so far, as typed. Only Azure DevOps asks for a team.
 */
export interface SetupAnswers {
    itemSource: RepositoryItemSource['kind'];
    /** The Azure DevOps team whose backlog and current sprint the board reads. */
    team?: string;
    role: string;
}

/** What an onboarding has answered so far. Later steps add theirs. */
export interface OnboardingAnswers {
    /** The picked T3 project's id. */
    projectId: string;
    /** The picked T3 project's provider, from its origin's host; absent while the dialog hasn't read it. */
    provider?: Provider;
    /** The Provider and item source step's answers, once it has shown. */
    setup?: SetupAnswers;
    /** The wizard's answers the user changed from their detected defaults. */
    choices?: OnboardingChoices;
}

/** The onboarding wizard's answers, each one absent while its detected default stands. */
export interface OnboardingChoices {
    newLabels?: LocalSetupAnswers['newLabels'];
    createIssuesFromAddItem?: boolean;
    createIssuesFromRetro?: boolean;
    writeRefinedSpec?: boolean;
    vocabulary?: VocabularyMapping;
    structureSync?: boolean;
    itemSource?: RepositoryItemSource;
    role?: string;
    domainDocs?: DomainDocLocation;
    skills?: string[];
    /** The other onboarded repositories ticked in the Connections step. */
    connections?: string[];
}

/** Where an onboarding stopped when its dialog closed, so Resume reopens it there. */
export interface OnboardingProgress {
    /** The step it was on, by id. */
    step: string;
    /** The steps it has passed, by id. */
    done: string[];
    answers: OnboardingAnswers;
}

/** A repository on this Mac's list that is still onboarding, with where it stopped. */
export interface OnboardingRepository {
    repo: string;
    progress: OnboardingProgress;
}

/** A T3 project onboarding can offer, with what the T3 project step shows about its repository. */
export interface ProjectChoice {
    id: string;
    /** The T3 project's title. */
    name: string;
    folder: string;
    /** `folder` as the step shows it, with the home folder as `~`, which the browser can't work out. */
    shownFolder: string;
    /** `owner/name` from the folder's origin; null when the folder isn't a main checkout with an origin on a provider. */
    repo: string | null;
    provider: Provider | null;
    /** Why `repo` is null; null when it isn't. */
    blocked: 'linked-worktree' | 'no-provider-origin' | null;
    /** Whether the repository is already on the board or is onboarding. Unusable settings can start fresh. */
    onBoard: boolean;
    /** The project's icon from T3; null when it has none or T3 hasn't given one yet. */
    icon: ProjectIcon | null;
}

/**
 * The checks onboarding's Checks step runs after the command checks: that the T3 project's folder is the main checkout
 * of the repository's origin, that the item source can be read, and that gh's login can push to the repository.
 */
export const SETUP_CHECKS = ['checkout', 'source', 'push'] as const;

export type SetupCheckId = (typeof SETUP_CHECKS)[number];

/** A setup check's result: what it found, or the problem with its fix and the command that fixes it, when one does. */
export type SetupCheckResult =
    | { passed: true; detail: string }
    | { passed: false; problem: string; fix: string; command?: string };

/** A fact onboarding's detection found, or why the login's access kept it from finding it. */
export type Detected<T> = { found: T } | { refused: string };

/**
 * What onboarding detects about a repository before it asks anything, reading only: each fact found, or Refused with
 * why. `access` is what the login's permissions show for each operation; one they can't settle stays unverified.
 */
export interface SetupDetection {
    repo: string;
    azureReadOnly?: boolean;
    provider: Provider;
    /** The T3 project's folder, once it is the repository's only main checkout. */
    checkout: Detected<string>;
    /** The item sources the board can read: the repository's issues, or one per Azure DevOps team. */
    itemSources: Detected<RepositoryItemSource[]>;
    access: Record<RepositoryOperation, OperationAccess>;
    /** The repository's own glossary and ADRs when it has either, else off. */
    domainDocs: Detected<DomainDocLocation>;
    /** The names of the repository's project skills, which the user may select as coding guidance. */
    projectSkills: Detected<string[]>;
}

/** Onboarding's answers, which become the repository's local settings. */
export interface LocalSetupAnswers {
    createIssuesFromAddItem?: boolean;
    createIssuesFromRetro?: boolean;
    writeRefinedSpec?: boolean;
    newLabels?: Partial<Record<import('./vocabulary.ts').VocabularyKey, string[]>>;
    vocabulary?: VocabularyMapping;
    structureSync?: boolean;
    projectId: string;
    role: string;
    itemSource: RepositoryItemSource;
    domainDocs: DomainDocLocation;
    skills: string[];
}
