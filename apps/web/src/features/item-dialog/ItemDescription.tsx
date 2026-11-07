// The item dialog's description: the loading state or the error that stands in for it, the Spec's sync notice, and
// the description editor with Save and Cancel under it once Edit opens it.

import type { ItemDetails, TextFormat } from '@lar-factory/shared';
import {
    Button,
    buttonKind,
    DetailsText,
    Disclosure,
    EditActions,
    EditorSlot,
    HeaderStatus,
    Heading,
    Inline,
    MainColumnSlot,
    MainSection,
    MarkdownEditor,
    RichText,
    SectionHeader,
    SkeletonLoader,
    SpecSync,
    Stack,
    TextSection,
} from '@lar-works/design-system';
import { Pencil } from '@lar-works/design-system/icons';
import { useState } from 'react';

import { detailsCache } from './DetailsCache';
import type { DescriptionEdit } from './useDescriptionEdit';
import type { ItemDetailsRead } from './useItemDetails';
import { postAction } from '@/services/board/board.service';
import { MarkdownDiagrams } from '@/shared/diagrams/MarkdownDiagrams';

/** A fixed-width placeholder for the main column while the details load. */
function Loading() {
    return (
        <SkeletonLoader label="Loading details">
            <Stack>
                <SkeletonLoader.Shape width="full" />
                <SkeletonLoader.Shape width="wide" />
                <SkeletonLoader.Shape width="full" />
                <SkeletonLoader.Shape width="short" />
                <SkeletonLoader.Shape presentation="card" />
            </Stack>
        </SkeletonLoader>
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
            <EditorSlot fill={fill}>
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
            </EditorSlot>
            {/* A save error takes the status's place and wraps under it, so Cancel and Save stay where they were. */}
            <EditActions status={edit.dirty ? 'Unsaved changes' : 'No changes'} error={edit.error} data-edit-actions>
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
            </EditActions>
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
        <SpecSync
            status={
                spec.error || spec.warning || spec.pending
                    ? (spec.warning ?? spec.error ?? 'The Spec is waiting to save to the tracker.')
                    : undefined
            }
            error={error}
        >
            {spec.held ? (
                <>
                    <Disclosure label="Review held GitHub edit" presentation="section">
                        <Heading as="h3" variant="title">
                            {spec.held.title}
                        </Heading>
                        <RichText text={spec.held.body} format="markdown" />
                    </Disclosure>
                    <Inline as="span">
                        <Button {...buttonKind('other')} disabled={busy} onClick={() => void act('accept')}>
                            Accept edit
                        </Button>
                        <Button {...buttonKind('other')} disabled={busy} onClick={() => void act('reject')}>
                            Reject edit
                        </Button>
                    </Inline>
                </>
            ) : (
                (spec.pending || spec.error) && (
                    <Button {...buttonKind('other')} loading={busy} onClick={() => void act('retry')}>
                        Retry Spec sync
                    </Button>
                )
            )}
        </SpecSync>
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
}: {
    itemId: string;
    refresh: () => Promise<boolean>;
    read: ItemDetailsRead;
    edit: DescriptionEdit;
    editable: boolean;
    fill: boolean;
    ticketContext?: boolean;
}) {
    if (read.state === 'loading')
        return (
            <MainColumnSlot>
                <Loading />
            </MainColumnSlot>
        );

    if (read.state === 'failed')
        return (
            <DetailsText tone="error" mainColumn>
                Could not load the details: {read.error}
            </DetailsText>
        );

    const { sections } = read.details;
    // A save the details could not be read back after stands for the description until they are.
    const [body, format]: [string, TextFormat] =
        edit.saved === null ? [read.details.body, read.details.format] : [edit.saved, 'markdown'];

    return (
        <MainSection
            fill={fill}
            header={
                <SectionHeader
                    heading={read.details.spec ? 'Spec' : ticketContext ? 'Ticket description' : 'Description'}
                >
                    {!edit.editing && (
                        <>
                            {edit.saved !== null && <HeaderStatus>{RELOAD_FAILED}</HeaderStatus>}
                            {editable && (
                                <Button {...buttonKind('other')} leftIcon={<Pencil />} onClick={edit.start}>
                                    Edit
                                </Button>
                            )}
                        </>
                    )}
                </SectionHeader>
            }
            data-description
        >
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
                <DetailsText>No description.</DetailsText>
            )}
            {read.details.spec?.original && (
                <Disclosure label="Original" presentation="section">
                    <RichText text={read.details.spec.original} format={read.details.spec.originalFormat} />
                </Disclosure>
            )}
            {sections?.map((section) => (
                <TextSection key={section.title} heading={section.title}>
                    <RichText text={section.body} format={section.format} />
                </TextSection>
            ))}
        </MainSection>
    );
}
