// What the item dialog shows from an item's details: the description and comments in its main column, and the people,
// dates, milestone or iteration and area, and sub-tickets in its sidebar. While the details load each shows a
// placeholder, and a failed read shows its error in the description's place; the board's own fields never wait.

import type { ReactNode } from 'react';
import { CircleCheck, CircleDot, LoaderCircle } from 'lucide-react';
import { onAzure, shortAgo } from '@lar-factory/shared';
import type { Item, ItemComment, ItemDetails } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/badge';
import { Button } from '@lar-factory/ui/button';
import { RichText } from '@lar-factory/ui/rich-text';
import type { ItemDetailsRead } from './use-item-details.ts';
import { useOlderComments } from './use-older-comments.ts';
import type { DetailsEntry } from './details-cache.ts';

const Heading = ({ children }: { children: ReactNode }) => <h2 className="m-0 text-[13px] font-medium text-(--muted-foreground)">{children}</h2>;

const Avatar = ({ name }: { name: string }) => (
  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-(--secondary) text-[11px] font-semibold uppercase text-(--secondary-foreground)">{name[0]}</span>
);

const Person = ({ name }: { name: string }) => <span className="inline-flex min-w-0 items-center gap-1.5"><Avatar name={name} /><span className="min-w-0 truncate">{name}</span></span>;

const Placeholder = ({ className }: { className: string }) => <div className={`animate-pulse rounded bg-(--muted) ${className}`} />;

/** A fixed-width placeholder for the main column while the details load. */
function Loading() {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Loading details">
      {['w-11/12', 'w-3/4', 'w-5/6', 'w-2/5'].map((w) => <Placeholder key={w} className={`h-3.5 ${w}`} />)}
      <Placeholder className="mt-2 h-20 w-full" />
    </div>
  );
}

function Comment({ comment, now }: { comment: ItemComment; now: number }) {
  return (
    <li className="flex gap-3">
      <Avatar name={comment.author} />
      <div className="min-w-0 flex-1 rounded-(--radius-lg) border border-(--border) bg-(--card)">
        <div className="flex items-center gap-2 border-b border-(--border) px-3 py-1.5 text-xs">
          <span className="font-medium">{comment.author}</span>
          <time className="text-(--muted-foreground)" dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>{shortAgo(comment.createdAt, now)}</time>
        </div>
        <RichText className="px-3 py-2" text={comment.body} format={comment.format} />
      </div>
    </li>
  );
}

/** The comments, newest first: the latest the details hold, then each page "Load 10 more" fetched. Remounts with each open of the dialog. */
function Comments({ itemId, entry, now }: { itemId: string; entry: DetailsEntry; now: number }) {
  const older = useOlderComments(itemId, entry);
  const comments = [...entry.details.comments, ...older.comments];
  return (
    <div className="grid min-w-0 gap-2" data-comments>
      <Heading>Comments{comments.length > 0 && ` · ${comments.length}`}</Heading>
      {comments.length > 0
        ? <ol className="m-0 grid list-none gap-3 p-0">{comments.map((c) => <Comment key={c.id} comment={c} now={now} />)}</ol>
        : <p className="m-0 text-sm text-(--muted-foreground)">No comments.</p>}
      {older.hasMore && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" disabled={older.loading} onClick={older.loadMore}>{older.loading && <LoaderCircle className="animate-spin" />}Load 10 more</Button>
          {older.error && <p className="m-0 text-xs text-(--error-foreground)" role="alert">Could not load older comments: {older.error}</p>}
        </div>
      )}
    </div>
  );
}

/** The description and the comments, newest first. */
export function ItemText({ itemId, read, now }: { itemId: string; read: ItemDetailsRead; now: number }) {
  if (read.state === 'loading') return <Loading />;
  if (read.state === 'failed') return <p className="m-0 text-sm text-(--error-foreground)" role="alert">Could not load the details: {read.error}</p>;
  const { body, format } = read.details;
  return (
    <>
      <div className="grid min-w-0 gap-2" data-description>
        <Heading>Description</Heading>
        {body ? <RichText text={body} format={format} /> : <p className="m-0 text-sm text-(--muted-foreground)">No description.</p>}
      </div>
      <Comments itemId={itemId} entry={read.entry} now={now} />
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid min-w-0 gap-1 text-sm"><div className="text-xs text-(--muted-foreground)">{label}</div><div className="min-w-0 break-words">{children}</div></div>;
}

const When = ({ iso, now }: { iso: string; now: number }) => <time dateTime={iso} title={new Date(iso).toLocaleString()}>{shortAgo(iso, now)}</time>;

/** A field from the details: a placeholder while they load, nothing once they failed or hold none. */
function FromDetails({ read, label, show }: { read: ItemDetailsRead; label: string; show: (d: ItemDetails) => ReactNode }) {
  if (read.state === 'loading') return <Field label={label}><Placeholder className="h-4 w-24" /></Field>;
  if (read.state === 'failed') return null;
  const shown = show(read.details);
  return shown ? <Field label={label}>{shown}</Field> : null;
}

/** Author, assignees, labels, dates, milestone or iteration and area, and sub-tickets. Labels and the update time come from the board. */
export function ItemFields({ item, read, now }: { item: Item; read: ItemDetailsRead; now: number }) {
  const azure = Boolean(item.repo && onAzure(item.repo));
  return (
    <div className="grid min-w-0 gap-4">
      <FromDetails read={read} label="Author" show={(d) => d.author && <Person name={d.author} />} />
      <FromDetails read={read} label="Assignees" show={(d) => d.assignees.length > 0 && <span className="grid gap-1">{d.assignees.map((a) => <Person key={a} name={a} />)}</span>} />
      {item.labels.length > 0 && <Field label="Labels"><span className="flex flex-wrap gap-1" data-labels>{item.labels.map((l) => <Badge key={l} variant="outline">{l}</Badge>)}</span></Field>}
      {azure
        ? <><FromDetails read={read} label="Iteration" show={(d) => d.iteration} /><FromDetails read={read} label="Area" show={(d) => d.area} /></>
        : <FromDetails read={read} label="Milestone" show={(d) => d.milestone} />}
      <FromDetails read={read} label="Created" show={(d) => d.createdAt && <When iso={d.createdAt} now={now} />} />
      <Field label="Updated"><When iso={item.updatedAt} now={now} /></Field>
      <FromDetails read={read} label="Sub-tickets" show={(d) => d.subTickets.length > 0 && (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {d.subTickets.map((s) => (
            <li key={s.url} className="flex items-start gap-2">
              {s.state === 'closed' ? <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-(--success)" /> : <CircleDot className="mt-0.5 size-3.5 shrink-0 text-(--muted-foreground)" />}
              <a href={s.url} target="_blank" rel="noopener" className="min-w-0 hover:underline"><span className="text-(--muted-foreground)">#{s.number}</span> {s.title}</a>
            </li>
          ))}
        </ul>
      )} />
    </div>
  );
}
