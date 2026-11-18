// What a tracker is called, how it names and links its tickets and what its labels can do, so screens read this entry
// instead of checking a provider's name, and a new tracker adds one entry.
import { customLabelProblem, customTagProblem, tagSeparatorProblem } from './custom-labels.ts';
import { isKindName, isManagedLabel, shownLabels } from './managed-labels.ts';
import { decodePart, isRepoTag, sameRepo } from './model.ts';
import type { Item, RepoConfig } from './model.ts';
import { azureTicketUrl, githubTicketUrl, onAzure } from './ticket-url.ts';
import { STRUCTURE_LABEL } from './tracker-structure.ts';

/** The icon the web draws for a tracker; the design system has one for each key. */
export type TrackerIcon = 'github' | 'azure';

export interface TrackerCapabilities {
    /** The tracker's name, such as "GitHub". */
    name: string;
    /** Which of the design system's tracker icons is this tracker's. */
    icon: TrackerIcon;
    /** What the tracker calls a ticket, in a sentence: "issue". */
    ticket: string;
    /** The ticket word with its article: "an issue". */
    aTicket: string;
    /** The tracker's name after the preposition a sentence uses for a ticket kept there: "on GitHub". */
    place: string;
    /** What closing a ticket from Archive does there, as its prompt says it. */
    close: {
        /** The confirm button: "Close issue". */
        confirm: string;
        /** What the close does and how to undo it. */
        detail: string;
        /** What happened, once it closed the ticket of the work named `name`. */
        done: (name: string) => string;
    };
    /** The page of ticket `number` in `repo`, a repository key. */
    ticketUrl: (repo: string, number: number) => string;
    /** What the tracker calls a label, in a sentence. */
    noun: string;
    /** What the tracker calls its labels, as a heading. */
    heading: string;
    /** Whether a label has a colour. */
    color: boolean;
    /** Whether a label has a description. */
    description: boolean;
    /** What deleting a label does beyond the label list. */
    deleteWarning: string;
    /** How far a change to a label reaches. */
    changeScope: 'repository' | 'project';
    /** Whether a change to one of `repo`'s labels is also a change to `other`'s. */
    sharesLabels: (repo: string, other: string) => boolean;
    /** The label structure sync needs, or null when it needs none. */
    syncLabel: string | null;
    /** Why a label can't be created by itself, or null when it can. */
    createUnavailable: string | null;
    /** Why a person can't give a label this name, or null when they can. */
    nameProblem: (name: string) => string | null;
    /** Whether the factory reads this name as meaning on this tracker, so it hides the label from rows and pickers and locks it in settings. */
    isManaged: (name: string) => boolean;
    /** Why a ticket can't take this name as one label, whatever the tracker's list holds, or null when it can. */
    ticketNameProblem: (name: string) => string | null;
}

export interface TrackerLabel {
    name: string;
    /** Six hex digits, with no `#`. */
    color?: string;
    description?: string;
}

/**
 * A tracker's label operations, whose adapters are in tracker-labels.ts. Adding or removing labels on a ticket changes only those
 * names, since replacing the ticket's whole set from a read that stopped short would drop the rest.
 */
export interface TrackerLabels {
    list(): Promise<TrackerLabel[]>;
    create(label: TrackerLabel): Promise<TrackerLabel>;
    /** Renames the label `name` and changes its colour or description, each only when given. */
    update(name: string, change: Partial<TrackerLabel>): Promise<TrackerLabel>;
    delete(name: string): Promise<void>;
    addToTicket(ticket: number, names: readonly string[]): Promise<void>;
    removeFromTicket(ticket: number, names: readonly string[]): Promise<void>;
}

/** What a ticket's kind reads from and writes to, beside its labels. */
export interface TicketKinds {
    /** The labels and type the ticket has now. */
    read: (ticket: number) => Promise<{ labels: string[]; type: string | null }>;
    /** Changes the ticket's type, with whatever else that type needs in order to show the ticket's text. */
    setType: (ticket: number, type: string) => Promise<void>;
    /** The types `team`'s board shows, or null when a tracker's board shows every type. */
    boardTypes: (team?: string) => Promise<string[] | null>;
}

/** One label to add to a ticket or remove from it. */
export interface LabelChange {
    label: string;
    action: 'add' | 'remove';
}

/** An Azure DevOps repository's organization and project, however its origin writes them. */
const azureProject = (repo: string) => repo.split('/').slice(0, 2).map(decodePart).join('/');

const GITHUB: TrackerCapabilities = {
    name: 'GitHub',
    icon: 'github',
    ticket: 'issue',
    aTicket: 'an issue',
    place: 'on GitHub',
    close: {
        confirm: 'Close issue',
        detail: 'This closes the issue as "not planned" on GitHub. You can reopen it on GitHub.',
        done: (name) => `Closed ${name} as "not planned".`,
    },
    ticketUrl: githubTicketUrl,
    noun: 'label',
    heading: 'Labels',
    color: true,
    description: true,
    deleteWarning: 'This removes it from every ticket.',
    changeScope: 'repository',
    sharesLabels: sameRepo,
    syncLabel: STRUCTURE_LABEL,
    createUnavailable: null,
    nameProblem: customLabelProblem,
    isManaged: isManagedLabel,
    ticketNameProblem: () => null,
};

const AZURE_DEVOPS: TrackerCapabilities = {
    name: 'Azure DevOps',
    icon: 'azure',
    ticket: 'work item',
    aTicket: 'a work item',
    place: 'in Azure DevOps',
    close: {
        confirm: 'Move to Removed',
        detail: 'This moves the work item to Removed in Azure DevOps. You can reactivate it in Azure DevOps.',
        done: (name) => `Moved ${name} to Removed.`,
    },
    ticketUrl: azureTicketUrl,
    noun: 'tag',
    heading: 'Tags',
    color: false,
    description: false,
    deleteWarning: 'This removes it from every work item and pull request.',
    changeScope: 'project',
    syncLabel: null,
    sharesLabels: (repo, other) => onAzure(other) && sameRepo(azureProject(repo), azureProject(other)),
    createUnavailable:
        'Azure DevOps has no way to create a tag on its own. A new tag appears when it is first added to a work item.',
    nameProblem: customTagProblem,
    // A repo- tag decides where a work item shows, and a second one hides it.
    isManaged: (name) => isManagedLabel(name) || isRepoTag(name),
    ticketNameProblem: tagSeparatorProblem,
};

/** The capabilities of the tracker holding `repo`, a repository key. */
export const trackerCapabilities = (repo: string): TrackerCapabilities => (onAzure(repo) ? AZURE_DEVOPS : GITHUB);

/** Why a person can't type one of `names` as a new label for `repo`, or null when they can. A blank field names nothing. */
export const typedLabelsProblem = (repo: string, names: readonly string[]): string | null =>
    names
        .filter((name) => name.trim())
        .map((name) => trackerCapabilities(repo).nameProblem(name))
        .find(Boolean) ?? null;

/** Whether a kind mapping offers `name`: a kind's own names, which a repository can map to, or any label that isn't managed. */
export const kindMappingOffers = (repo: string, name: string): boolean =>
    !trackerCapabilities(repo).isManaged(name) || isKindName(name);

/** The labels `item`'s row shows, under its repository's mappings and its tracker's managed labels. */
export const labelsOnRow = (
    item: Pick<Item, 'kind' | 'deliveryKind' | 'labels' | 'repo'>,
    repos: readonly Pick<RepoConfig, 'repo' | 'setup'>[],
): string[] =>
    shownLabels(
        item,
        repos.find((r) => sameRepo(r.repo, item.repo))?.setup?.vocabulary,
        trackerCapabilities(item.repo).isManaged,
    );
