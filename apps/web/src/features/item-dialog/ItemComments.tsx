// The item dialog's comments, newest first, with Load older comments.

import type { ItemComment } from '@lar-factory/shared';
import { shortAgo } from '@lar-factory/shared';
import {
    EmptyState,
    Button,
    Comment as CommentCard,
    CommentList,
    Inline,
    PageError,
    RichText,
    Stack,
} from '@lar-works/design-system';

import { useOlderComments, type DetailsEntry, type ItemDetailsRead } from '@/services/items/items.hooks';
import { buttonKind, DetailsHeading, MainSection } from '@/ui/board';

function Comment({ comment, now }: { comment: ItemComment; now: number }) {
    return (
        <CommentCard
            author={comment.author}
            time={
                <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
                    {shortAgo(comment.createdAt, now)}
                </time>
            }
        >
            <RichText text={comment.body} format={comment.format} />
        </CommentCard>
    );
}

/** The comments, newest first: the latest the details hold, then each older page fetched. Remounts with each open of the dialog. */
function Comments({
    itemId,
    entry,
    now,
    ticketContext,
}: {
    itemId: string;
    entry: DetailsEntry;
    now: number;
    ticketContext: boolean;
}) {
    const older = useOlderComments(itemId, entry);
    const comments = [...entry.details.comments, ...older.comments];

    return (
        <MainSection
            header={
                <DetailsHeading presentation="label">
                    {ticketContext ? 'Ticket comments' : 'Comments'}
                    {comments.length > 0 && ` · ${comments.length}`}
                </DetailsHeading>
            }
            data-comments
        >
            {comments.length > 0 ? (
                <CommentList>
                    {comments.map((c) => (
                        <Comment key={c.id} comment={c} now={now} />
                    ))}
                </CommentList>
            ) : (
                !older.hasMore && <EmptyState size="inline" title="No comments." />
            )}
            {older.hasMore && (
                <Inline as="span" wrap align="center" space="group">
                    <Button {...buttonKind('other')} loading={older.loading} onClick={older.loadMore}>
                        Load older comments
                    </Button>
                    {older.error && (
                        <Stack role="alert">
                            <PageError
                                size="inline"
                                title="Couldn’t load older comments"
                                description={older.error}
                                primaryAction={{ label: 'Try again', onAction: older.loadMore }}
                            />
                        </Stack>
                    )}
                </Inline>
            )}
        </MainSection>
    );
}

/** The comments, newest first; none while the details load or when the read failed. */
export function ItemComments({
    itemId,
    read,
    now,
    ticketContext = false,
}: {
    itemId: string;
    read: ItemDetailsRead;
    now: number;
    ticketContext?: boolean;
}) {
    return read.state === 'loaded' ? (
        <Comments itemId={itemId} entry={read.entry} now={now} ticketContext={ticketContext} />
    ) : null;
}
