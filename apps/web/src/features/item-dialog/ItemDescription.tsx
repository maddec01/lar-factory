// Ticket description, Spec sync notice and description editor.

import type { TextFormat } from '@lar-factory/shared';
import {
    Button,
    Disclosure,
    MarkdownEditor,
    PageError,
    RichText,
    SkeletonLoader,
    Stack,
} from '@lar-works/design-system';
import { CircleAlert, Pencil } from '@lar-works/design-system/icons';
import { useState } from 'react';

import { SpecNotice } from './SpecNotice';
import { proseOf, type DescriptionEdit } from './useDescriptionEdit';
import type { ItemDetailsRead } from '@/services/items/items.hooks';
import { MarkdownDiagrams } from '@/shared/diagrams/MarkdownDiagrams';
import {
    AddDescription,
    buttonKind,
    EditActions,
    EditorSlot,
    HeaderStatus,
    MainColumnSlot,
    MainSection,
    SectionHeader,
    TextSection,
} from '@/ui/board';

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

function DetailsLoadError({ error, refresh }: { error: string; refresh: () => Promise<boolean> }) {
    const [retrying, setRetrying] = useState(false);

    return (
        <MainColumnSlot>
            <Stack role="alert" data-details-error>
                <PageError
                    size="panel"
                    icon={<CircleAlert />}
                    title="Couldn’t load the details"
                    description={error}
                    primaryAction={{
                        label: 'Try again',
                        busy: retrying,
                        onAction: () => {
                            setRetrying(true);
                            void refresh().finally(() => setRetrying(false));
                        },
                    }}
                />
            </Stack>
        </MainColumnSlot>
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
    if (read.state === 'loading')
        return (
            <MainColumnSlot>
                <Loading />
            </MainColumnSlot>
        );

    if (read.state === 'failed') return <DetailsLoadError error={read.error} refresh={refresh} />;

    const { sections } = read.details;
    // A save the details could not be read back after stands for the description until they are.
    const [body, format]: [string, TextFormat] =
        edit.saved === null ? [read.details.body, read.details.format] : [edit.saved, 'markdown'];

    // An empty description that can be written is one quiet button, with no heading over nothing.
    if (!edit.editing && editable && !proseOf(body) && !read.details.spec && !sections?.length)
        return <AddDescription onAdd={edit.start} />;

    return (
        <MainSection
            fill={fill}
            header={
                <SectionHeader
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
                    body={edit.draft ?? proseOf(body)}
                    format={edit.draft === null ? format : 'markdown'}
                    edit={edit}
                    fill={fill}
                />
            ) : (
                proseOf(body) &&
                (format === 'markdown' ? <MarkdownDiagrams text={body} /> : <RichText text={body} format={format} />)
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
