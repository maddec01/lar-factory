// The item dialog's description: the loading state or the error that stands in for it, the Spec's sync notice, and
// the description editor with Save and Cancel under it once Edit opens it.

import type { ItemDetails, TextFormat } from '@lar-factory/shared';
import { Button, buttonKind, MarkdownEditor, RichText } from '@lar-works/design-system';
import { Pencil } from '@lar-works/design-system/icons';
import { useState } from 'react';

import { detailsCache } from './DetailsCache';
import { Heading, Placeholder } from './DetailsParts';
import type { DescriptionEdit } from './useDescriptionEdit';
import type { ItemDetailsRead } from './useItemDetails';
import { postAction } from '@/services/board/board.service';
import { MarkdownDiagrams } from '@/shared/diagrams/MarkdownDiagrams';

/** A fixed-width placeholder for the main column while the details load. */
function Loading() {
    return (
        <div className="grid gap-3" aria-busy="true" aria-label="Loading details">
            {['w-11/12', 'w-3/4', 'w-5/6', 'w-2/5'].map((w) => (
                <Placeholder key={w} className={`h-3.5 ${w}`} />
            ))}
            <Placeholder className="mt-2 h-20 w-full" />
        </div>
    );
}

/** The description editor on `body`, then whether it changed or why its save failed, Cancel and Save. */
function EditDescription({
    body,
    format,
    edit,
    fill,
}: {
    body: string;
    format: TextFormat;
    edit: DescriptionEdit;
    fill: boolean;
}) {
    return (
        <>
            <div className={fill ? 'flex min-h-0 flex-col' : 'contents'}>
                <MarkdownEditor
                    label="Description"
                    placeholder="Add a description…"
                    value={body}
                    format={format}
                    autoFocus
                    onBaseline={edit.setBaseline}
                    onChange={edit.change}
                    disabled={edit.saving}
                    fill={fill}
                />
            </div>
            {/* A save error takes the status's place and wraps under it, so Cancel and Save stay where they were. */}
            <div className="flex items-start gap-2" data-edit-actions>
                {edit.error ? (
                    <p className="m-0 me-auto min-w-0 flex-1 py-1.5 text-xs text-(--error-foreground)" role="alert">
                        {edit.error}
                    </p>
                ) : (
                    <span className="me-auto min-w-0 flex-1 py-1.5 text-xs text-(--muted-foreground)">
                        {edit.dirty ? 'Unsaved changes' : 'No changes'}
                    </span>
                )}
                <Button {...buttonKind('other')} disabled={edit.saving} onClick={edit.cancel}>
                    Cancel
                </Button>
                <Button
                    {...buttonKind('main')}
                    disabled={!edit.dirty}
                    loading={edit.saving}
                    onClick={() => void edit.save()}
                >
                    Save
                </Button>
            </div>
        </>
    );
}

function SpecNotice({
    itemId,
    spec,
    refresh,
}: {
    itemId: string;
    spec: NonNullable<ItemDetails['spec']>;
    refresh: () => Promise<boolean>;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const act = async (action: 'retry' | 'accept' | 'reject') => {
        setBusy(true);
        setError(null);

        const result = await postAction('/api/item-spec', { itemId, generation: spec.generation, action });

        if (result.error) setError(result.error);
        else {
            detailsCache.drop(itemId);

            if (!(await refresh())) setError('Could not reload the Spec. Reopen the item to read it.');
        }

        setBusy(false);
    };

    return (
        <div className="grid gap-2 text-sm" data-spec-sync>
            {(spec.error || spec.warning || spec.pending) && (
                <p className="m-0" role="status">
                    {spec.warning ?? spec.error ?? 'The Spec is waiting to save to the tracker.'}
                </p>
            )}
            {spec.held ? (
                <>
                    <details>
                        <summary className="cursor-pointer">Review held GitHub edit</summary>
                        <h3>{spec.held.title}</h3>
                        <RichText text={spec.held.body} format="markdown" />
                    </details>
                    <div className="flex gap-2">
                        <Button {...buttonKind('other')} disabled={busy} onClick={() => void act('accept')}>
                            Accept edit
                        </Button>
                        <Button {...buttonKind('other')} disabled={busy} onClick={() => void act('reject')}>
                            Reject edit
                        </Button>
                    </div>
                </>
            ) : (
                (spec.pending || spec.error) && (
                    <Button {...buttonKind('other')} loading={busy} onClick={() => void act('retry')}>
                        Retry Spec sync
                    </Button>
                )
            )}
            {error && (
                <p className="m-0 text-(--error-foreground)" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}

const RELOAD_FAILED = 'Saved; could not reload the details';

/**
 * The description, or the loading state or the error that stands in for it. Edit shows when `editable`, as this Mac
 * lets the factory edit the repository's tickets. While `edit` is open the editor takes the description's place,
 * filling the height left when `fill`.
 */
export function ItemDescription({
    itemId,
    refresh,
    read,
    edit,
    editable,
    fill,
    ticketContext = false,
    className,
}: {
    itemId: string;
    refresh: () => Promise<boolean>;
    read: ItemDetailsRead;
    edit: DescriptionEdit;
    editable: boolean;
    fill: boolean;
    ticketContext?: boolean;
    className: string;
}) {
    if (read.state === 'loading')
        return (
            <div className={className}>
                <Loading />
            </div>
        );

    if (read.state === 'failed')
        return (
            <p className={`m-0 text-sm text-(--error-foreground) ${className}`} role="alert">
                Could not load the details: {read.error}
            </p>
        );

    const { sections } = read.details;
    // A save the details could not be read back after stands for the description until they are.
    const [body, format]: [string, TextFormat] =
        edit.saved === null ? [read.details.body, read.details.format] : [edit.saved, 'markdown'];

    return (
        <div
            className={`grid min-w-0 gap-2 ${fill ? 'min-h-0 grid-rows-[auto_minmax(0,1fr)]' : ''} ${className}`}
            data-description
        >
            <div className="flex h-7 items-center justify-between gap-2">
                <h2 className="m-0 text-[11px] font-medium tracking-wider text-(--muted-foreground) uppercase">
                    {read.details.spec ? 'Spec' : ticketContext ? 'Ticket description' : 'Description'}
                </h2>
                {!edit.editing && (
                    <span className="flex min-w-0 items-center gap-3">
                        {edit.saved !== null && (
                            <span
                                className="truncate text-xs text-(--muted-foreground)"
                                role="status"
                                title={RELOAD_FAILED}
                            >
                                {RELOAD_FAILED}
                            </span>
                        )}
                        {editable && (
                            <Button {...buttonKind('other')} leftIcon={<Pencil />} onClick={edit.start}>
                                Edit
                            </Button>
                        )}
                    </span>
                )}
            </div>
            {read.details.spec && <SpecNotice itemId={itemId} spec={read.details.spec} refresh={refresh} />}
            {edit.editing ? (
                <EditDescription
                    body={edit.draft ?? body}
                    format={edit.draft === null ? format : 'markdown'}
                    edit={edit}
                    fill={fill}
                />
            ) : body ? (
                <>
                    {format === 'markdown' ? (
                        <MarkdownDiagrams text={body} />
                    ) : (
                        <RichText text={body} format={format} />
                    )}
                </>
            ) : (
                <p className="m-0 text-sm text-(--muted-foreground)">No description.</p>
            )}
            {read.details.spec?.original && (
                <details>
                    <summary className="cursor-pointer text-sm text-(--muted-foreground)">Original</summary>
                    <RichText text={read.details.spec.original} format={read.details.spec.originalFormat} />
                </details>
            )}
            {sections?.map((section) => (
                <section key={section.title} className="grid min-w-0 gap-2">
                    <Heading>{section.title}</Heading>
                    <RichText text={section.body} format={section.format} />
                </section>
            ))}
        </div>
    );
}
