// The item dialog's comments, newest first, with Load older comments.

import type { ItemComment } from '@lar-factory/shared';
import { shortAgo } from '@lar-factory/shared';
import { RichText } from '@lar-factory/ui/rich-text';
import { Button } from '@lar-works/design-system';

import type { DetailsEntry } from './DetailsCache';
import { Avatar, Heading } from './DetailsParts';
import type { ItemDetailsRead } from './useItemDetails';
import { useOlderComments } from './useOlderComments';
import { kind } from '@/shared/ui/buttons/ButtonKinds';

function Comment({ comment, now }: { comment: ItemComment; now: number }) {
    return (
        <li className="flex gap-3">
            <Avatar name={comment.author} />
            <div className="min-w-0 flex-1 rounded-(--radius-lg) border border-(--border) bg-(--card)">
                <div className="flex items-center gap-2 border-b border-(--border) px-3 py-1.5 text-xs">
                    <span className="font-medium">{comment.author}</span>
                    <time
                        className="text-(--muted-foreground)"
                        dateTime={comment.createdAt}
                        title={new Date(comment.createdAt).toLocaleString()}
                    >
                        {shortAgo(comment.createdAt, now)}
                    </time>
                </div>
                <RichText className="px-3 py-2" text={comment.body} format={comment.format} />
            </div>
        </li>
    );
}

/** The comments, newest first: the latest the details hold, then each older page fetched. Remounts with each open of the dialog. */
function Comments({
    itemId,
    entry,
    now,
    ticketContext,
    className,
}: {
    itemId: string;
    entry: DetailsEntry;
    now: number;
    ticketContext: boolean;
    className: string;
}) {
    const older = useOlderComments(itemId, entry);
    const comments = [...entry.details.comments, ...older.comments];

    return (
        <div className={`grid min-w-0 gap-2 ${className}`} data-comments>
            <Heading>
                {ticketContext ? 'Ticket comments' : 'Comments'}
                {comments.length > 0 && ` · ${comments.length}`}
            </Heading>
            {comments.length > 0 ? (
                <ol className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-3 p-0">
                    {comments.map((c) => (
                        <Comment key={c.id} comment={c} now={now} />
                    ))}
                </ol>
            ) : (
                !older.hasMore && <p className="m-0 text-sm text-(--muted-foreground)">No comments.</p>
            )}
            {older.hasMore && (
                <div className="flex flex-wrap items-center gap-3">
                    <Button {...kind('other')} loading={older.loading} onClick={older.loadMore}>
                        Load older comments
                    </Button>
                    {older.error && (
                        <p className="m-0 text-xs text-(--error-foreground)" role="alert">
                            Could not load older comments: {older.error}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

/** The comments, newest first; none while the details load or when the read failed. */
export function ItemComments({
    itemId,
    read,
    now,
    ticketContext = false,
    className,
}: {
    itemId: string;
    read: ItemDetailsRead;
    now: number;
    ticketContext?: boolean;
    className: string;
}) {
    return read.state === 'loaded' ? (
        <Comments itemId={itemId} entry={read.entry} now={now} ticketContext={ticketContext} className={className} />
    ) : null;
}
