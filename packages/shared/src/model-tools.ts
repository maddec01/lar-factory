// Local command availability contracts and rules.

import { type ItemSourceKind, type RepoConfig, onAzure } from './domain.ts';

/** The commands the board checks; az only while a listed repository is on Azure DevOps. */
export type CheckedTool = 'gh' | 't3' | 'git' | 'jq' | 'curl' | 'az';

/** A check that passed: the command runs, with the version it printed if it did. */
type Passed = { result: 'ok'; version?: string };

/** A missing command, naming the override that pointed nowhere if one did. */
type Missing = { result: 'missing'; override?: string };

/** gh runs, is missing or logged out, or needs an upgrade for lar-shape’s commands. */
export type GhCheck =
    | Passed
    | (Missing & { fix: string })
    | { result: 'logged-out'; version?: string; fix: string }
    | { result: 'outdated'; version: string; fix: string };

/** t3's check: it runs, it's missing, or T3 Code isn't running, so `t3` can't start threads. Its fix is to install or open T3 Code. */
export type T3Check = Passed | Missing | { result: 'not-running'; version?: string };

/** git's, jq's or curl's check: it runs, or it's missing. */
export type CommandCheck = Passed | (Missing & { fix: string });

/** az's check: it runs, it's missing, it's logged out, or it has no `azure-devops` extension. */
export type AzCheck =
    | Passed
    | (Missing & { fix: string })
    | { result: 'logged-out'; version?: string; fix: string }
    | { result: 'no-extension'; version?: string; fix: string };

/** The oldest gh lar-shape's scripts run with: 2.94.0 added `--parent`, `--add-sub-issue` and `--blocked-by`. */
export const GH_FLOOR = '2.94.0';

/**
 * Every check from one lookup, each as it lands; a check is absent before its first result, `gh` too when no listed
 * repository is on GitHub, and `az` when none is on Azure DevOps, as then it isn't checked. `fix` is the command that
 * fixes a failed check.
 */
export interface ToolChecks {
    gh?: GhCheck;
    t3?: T3Check;
    git?: CommandCheck;
    jq?: CommandCheck;
    curl?: CommandCheck;
    az?: AzCheck;
}

/** A provider's tool, which the board checks only while a listed repository needs it. */
export type ProviderTool = 'gh' | 'az';

/** Which commands the running check still checks, and which providers' tools it leaves out. */
export interface ToolProgress {
    checking: CheckedTool[];
    skipped: ProviderTool[];
}

/** Any command's check. */
export type ToolCheck = NonNullable<ToolChecks[CheckedTool]>;

/** A check that failed, of one command or of any. */
export type FailedCheck<C extends ToolCheck = ToolCheck> = Exclude<C, { result: 'ok' }>;

/** The tool's check if it failed; undefined when it passed, before the first check and in sample mode. */
export function failedCheck<N extends CheckedTool>(
    tools: ToolChecks | undefined,
    name: N,
): FailedCheck<NonNullable<ToolChecks[N]>> | undefined {
    const check = tools?.[name];

    // TypeScript can't narrow a generic indexed access (ToolChecks[N]) by `result`, so the cast restates it.
    return check && check.result !== 'ok' ? (check as FailedCheck<NonNullable<ToolChecks[N]>>) : undefined;
}

/** Where a repository's items come from: its issues or an Azure team's combined board. */
export type ItemSource = ItemSourceKind;

/** Where a repository's items come from, defaulting to GitHub issues. */
export function itemSource(repo: RepoConfig): ItemSource {
    return repo.items ?? 'issues';
}

/** The provider's tool a source reads with: az for an Azure DevOps board, gh for GitHub issues. */
export function providerTool(source: ItemSource): ProviderTool {
    return source === 'azure-board' ? 'az' : 'gh';
}

/** Whether any of the repositories is on GitHub, so the board reads it with gh. */
export function usesGh(repos: readonly { repo: string }[]): boolean {
    return repos.some((r) => !onAzure(r.repo));
}

/**
 * Whether gh's check stops the board reading a repository whose items come from `source`: for a GitHub source, before
 * gh's check, or while gh is missing or logged out. gh never
 * stops an Azure DevOps read.
 */
export function ghBlocksRead(check: GhCheck | undefined, source: ItemSource): boolean {
    if (providerTool(source) === 'az') return false;

    if (!check || check.result === 'missing' || check.result === 'logged-out') return true;

    return false;
}
