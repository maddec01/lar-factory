import { AzureDevOpsIcon, GitHubIcon, LaptopIcon } from '@lar-works/design-system/icons';

/** Where a piece of work's ticket is saved: a GitHub issue, an Azure DevOps work item, or only on this machine. */
export type ItemSource = 'github' | 'azure' | 'local';

/**
 * Where an item's ticket is saved, as a small muted mark named by `label`: a bordered square in details, with `corner`
 * a tab in a card's top right corner, which lets clicks through to the card, or with `bare` the icon alone, as a row's
 * quiet mark beside its project.
 */
export function SourceIcon({
    source,
    label,
    corner = false,
    bare = false,
}: {
    /** Where the ticket is saved: `github`, `azure` or `local`. */
    source: ItemSource;
    /** Names the source for screen readers. */
    label: string;
    /** Drawn as a tab in a card's top right corner. */
    corner?: boolean;
    /** Drawn as the icon alone, with no square around it. */
    bare?: boolean;
}) {
    const shape = bare
        ? 'size-3.5 shrink-0'
        : corner
          ? 'absolute right-2 top-2 z-10 size-5 rounded-md border pointer-events-none border-line bg-fill-hover'
          : 'size-5 shrink-0 rounded-md border border-line bg-fill-hover';

    return (
        <span role="img" aria-label={label} title={label} className={`text-fg-muted grid place-items-center ${shape}`}>
            {source === 'local' ? (
                <LaptopIcon className="size-3" strokeWidth={1.75} aria-hidden="true" />
            ) : source === 'github' ? (
                <GitHubIcon className="size-3" />
            ) : (
                <AzureDevOpsIcon className="size-3" />
            )}
        </span>
    );
}
