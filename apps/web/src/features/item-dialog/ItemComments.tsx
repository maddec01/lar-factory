// The item dialog's comments, newest first, with Load older comments.

import type { ItemComment } from '@lar-factory/shared';
import { shortAgo } from '@lar-factory/shared';
import {
    Button,
    buttonKind,
    ButtonRow,
    Comment as CommentCard,
    CommentList,
    DetailsHeading,
    DetailsText,
    MainSection,
    RichText,
    Text,
} from '@lar-works/design-system';

import type { DetailsEntry } from './DetailsCache';
import type { ItemDetailsRead } from './useItemDetails';
import { useOlderComments } from './useOlderComments';

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
                <DetailsHeading presentation="muted">
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
                !older.hasMore && <DetailsText>No comments.</DetailsText>
            )}
            {older.hasMore && (
                <ButtonRow layout="status">
                    <Button {...buttonKind('other')} loading={older.loading} onClick={older.loadMore}>
                        Load older comments
                    </Button>
                    {older.error && (
                        <Text variant="caption" tone="danger" role="alert">
                            Could not load older comments: {older.error}
                        </Text>
                    )}
                </ButtonRow>
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
