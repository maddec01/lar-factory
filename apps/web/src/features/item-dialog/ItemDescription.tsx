// Ticket description, Spec sync notice and description editor.

import type { TextFormat } from '@lar-factory/shared';
import { briefProse, trackerCapabilities } from '@lar-factory/shared';
import { Button, Disclosure, MarkdownEditor, RichText } from '@lar-works/design-system';
import { Pencil } from '@lar-works/design-system/icons';
import { useState } from 'react';

import { ExportMarkdown, ExportedLine, type Exported } from './RecordText';
import { SpecNotice } from './SpecNotice';
import { proseOf, type DescriptionEdit } from './useDescriptionEdit';
import { useDetailsWait } from './useDetailsWait';
import { useBoardStore } from '@/services/board/board.hooks';
import type { ItemDetailsRead } from '@/services/items/items.hooks';
import { MarkdownDiagrams } from '@/shared/diagrams/MarkdownDiagrams';
import {
    AddDescription,
    buttonKind,
    DetailsLoading,
    EditActions,
    EditorSlot,
    HeaderStatus,
    LoadFailed,
    MainSection,
    SectionHeader,
    TextSection,
} from '@/ui/board';

/** Where an item's details come from, in words. */
function useSource(itemId: string) {
    const item = useBoardStore((state) => state.data.items.find((i) => i.id === itemId));
    const repo = item?.repo;

    return {
        source: repo ? trackerCapabilities(repo).name : 'its ticket',
        url: item?.url ?? undefined,
    };
}

/** The description's heading over what couldn't be read: try again, or open the ticket in its tracker. */
function Unavailable({
    itemId,
    heading,
    reason,
    refresh,
}: {
    itemId: string;
    heading: string;
    reason?: string | undefined;
    refresh: () => Promise<boolean>;
}) {
    const { source, url } = useSource(itemId);
    const [retrying, setRetrying] = useState(false);

    return (
        <MainSection header={<SectionHeader heading={heading} prose />}>
            <LoadFailed
                what={url ? 'details' : `details from ${source}`}
                reason={reason}
                retrying={retrying}
                link={url ? { label: `Open in ${source}`, href: url } : undefined}
                onRetry={() => {
                    if (retrying) return;

                    setRetrying(true);
                    void refresh().finally(() => setRetrying(false));
                }}
                data-details-error
            />
        </MainSection>
    );
}

/** The description's heading and a short skeleton in its place while the details load, with its ticket's link from the
 *  start; a slow read adds that it can take a while, and one that takes too long gives way to the line that offers to
 *  try again. */
function Loading({ itemId, heading, refresh }: { itemId: string; heading: string; refresh: () => Promise<boolean> }) {
    const { source, url } = useSource(itemId);
    const waited = useDetailsWait(itemId);

    if (waited === 'too long')
        return <Unavailable itemId={itemId} heading={heading} reason="It took too long to answer." refresh={refresh} />;

    return (
        <DetailsLoading
            heading={heading}
            slow={waited === 'slow' ? 'This can take a while.' : undefined}
            source={source}
            href={url}
        >
            {`Loading details from ${source}…`}
        </DetailsLoading>
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
                <Button {...buttonKind('other', { size: 'md' })} disabled={edit.saving} onClick={edit.cancel}>
                    Cancel
                </Button>
                <Button
                    {...buttonKind('main', { size: 'md' })}
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
    const [exported, setExported] = useState<Exported>({ state: 'idle' });

    if (read.state === 'loading')
        return (
            <Loading itemId={itemId} heading={ticketContext ? 'Ticket description' : 'Description'} refresh={refresh} />
        );

    if (read.state === 'failed')
        return (
            <Unavailable
                itemId={itemId}
                heading={ticketContext ? 'Ticket description' : 'Description'}
                reason={read.error}
                refresh={refresh}
            />
        );

    const { sections } = read.details;
    const exportsRecord = Boolean(read.details.spec && read.details.record);
    // A save the details could not be read back after stands for the description until they are.
    const [body, format]: [string, TextFormat] =
        edit.saved === null ? [read.details.body, read.details.format] : [edit.saved, 'markdown'];

    // An empty description that can be written is one quiet button, with no heading over nothing.
    if (!edit.editing && editable && !proseOf(body) && !read.details.spec && !sections?.length)
        return <AddDescription heading={ticketContext ? 'Ticket description' : 'Description'} onAdd={edit.start} />;

    return (
        <MainSection
            fill={fill}
            header={
                <SectionHeader
                    prose
                    heading={
                        read.details.spec?.outdated
                            ? 'Out-of-date Spec'
                            : read.details.spec
                              ? 'Spec'
                              : ticketContext
                                ? 'Ticket description'
                                : 'Description'
                    }
                    empty={!edit.editing && !proseOf(body) && !editable && 'No description.'}
                >
                    {!edit.editing && (
                        <>
                            {edit.saved !== null && <HeaderStatus>{'Saved; couldn’t reload the details'}</HeaderStatus>}
                            {/* A Spec is the record's text, so its one heading row carries the record's Export too. */}
                            {exportsRecord && (
                                <ExportMarkdown itemId={itemId} exported={exported} setExported={setExported} />
                            )}
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
            {exportsRecord && <ExportedLine exported={exported} />}
            {read.details.spec && <SpecNotice itemId={itemId} spec={read.details.spec} refresh={refresh} />}
            {edit.editing ? (
                <EditDescription
                    body={edit.draft ?? proseOf(body)}
                    format={edit.draft === null ? format : 'markdown'}
                    edit={edit}
                    fill={fill}
                />
            ) : (
                proseOf(body) &&
                (format === 'markdown' ? (
                    <MarkdownDiagrams text={read.details.spec ? briefProse(body) : body} />
                ) : (
                    <RichText text={body} format={format} />
                ))
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
