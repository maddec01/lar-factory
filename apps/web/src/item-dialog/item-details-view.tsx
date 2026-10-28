// What the item dialog shows from an item's details: the description and comments in its main column, the people,
// labels, dates, milestone or iteration and area and a pull request's checks in the meta area under its title, and the
// sub-tickets in its sidebar. While the details load each shows a placeholder, and a failed read shows its error in the
// description's place; the board's own fields never wait.

import type { ReactNode } from 'react';
import { CircleCheck, CircleDot } from 'lucide-react';
import { onAzure, shortAgo } from '@lar-factory/shared';
import type { Item, ItemComment, ItemDetails } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Button } from '@lar-factory/ui/design-system/Button';
import { RichText } from '@lar-factory/ui/rich-text';
import { AzureFields, AgentWork, AgentWorkNote, ChecksBadge } from '../items/item-parts.tsx';
import type { ItemDetailsRead } from './use-item-details.ts';
import { useOlderComments } from './use-older-comments.ts';
import type { DetailsEntry } from './details-cache.ts';
import { kind } from '../buttons/button-kinds.tsx';

const Heading = ({ children }: { children: ReactNode }) => <h2 className="m-0 text-[13px] font-medium text-(--muted-foreground)">{children}</h2>;

const Avatar = ({ name }: { name: string }) => (
  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-(--secondary) text-[11px] font-semibold uppercase text-(--secondary-foreground)">{name[0]}</span>
);

const Person = ({ name }: { name: string }) => <span className="inline-flex min-w-0 max-w-full items-center gap-1.5"><Avatar name={name} /><span className="min-w-0 wrap-anywhere">{name}</span></span>;

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
function Comments({ itemId, entry, now, className }: { itemId: string; entry: DetailsEntry; now: number; className: string }) {
  const older = useOlderComments(itemId, entry);
  const comments = [...entry.details.comments, ...older.comments];
  return (
    <div className={`grid min-w-0 gap-2 ${className}`} data-comments>
      <Heading>Comments{comments.length > 0 && ` · ${comments.length}`}</Heading>
      {comments.length > 0
        ? <ol className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-3 p-0">{comments.map((c) => <Comment key={c.id} comment={c} now={now} />)}</ol>
        : <p className="m-0 text-sm text-(--muted-foreground)">No comments.</p>}
      {older.hasMore && (
        <div className="flex flex-wrap items-center gap-3">
          <Button {...kind('other')} loading={older.loading} onClick={older.loadMore}>Load 10 more</Button>
          {older.error && <p className="m-0 text-xs text-(--error-foreground)" role="alert">Could not load older comments: {older.error}</p>}
        </div>
      )}
    </div>
  );
}

/** The description, or the loading state or the error that stands in for it. */
export function ItemDescription({ read, className }: { read: ItemDetailsRead; className: string }) {
  if (read.state === 'loading') return <div className={className}><Loading /></div>;
  if (read.state === 'failed') return <p className={`m-0 text-sm text-(--error-foreground) ${className}`} role="alert">Could not load the details: {read.error}</p>;
  const { body, format, sections } = read.details;
  return (
    <div className={`grid min-w-0 gap-2 ${className}`} data-description>
      <Heading>Description</Heading>
      {body ? <RichText text={body} format={format} /> : <p className="m-0 text-sm text-(--muted-foreground)">No description.</p>}
      {sections?.map((section) => <section key={section.title} className="grid min-w-0 gap-2"><Heading>{section.title}</Heading><RichText text={section.body} format={section.format} /></section>)}
    </div>
  );
}

/** The comments, newest first; none while the details load or when the read failed. */
export function ItemComments({ itemId, read, now, className }: { itemId: string; read: ItemDetailsRead; now: number; className: string }) {
  return read.state === 'loaded' ? <Comments itemId={itemId} entry={read.entry} now={now} className={className} /> : null;
}

/** A labelled fact for the meta area; its value wraps rather than runs past the dialog. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex min-w-0 max-w-full items-baseline gap-1.5 text-sm"><span className="shrink-0 text-xs text-(--muted-foreground)">{label}</span><span className="min-w-0 wrap-anywhere">{children}</span></div>;
}

const When = ({ iso, now }: { iso: string; now: number }) => <time dateTime={iso} title={new Date(iso).toLocaleString()}>{shortAgo(iso, now)}</time>;

/** A fact from the details: a placeholder while they load, nothing once they failed or hold none. */
function FromDetails({ read, label, show }: { read: ItemDetailsRead; label: string; show: (d: ItemDetails) => ReactNode }) {
  if (read.state === 'loading') return <Fact label={label}><Placeholder className="h-4 w-20" /></Fact>;
  if (read.state === 'failed') return null;
  const shown = show(read.details);
  return shown ? <Fact label={label}>{shown}</Fact> : null;
}

/**
 * The meta area under the title: author, assignees, labels, milestone or iteration and area, dates, a pull request item's
 * checks, and the agent work figures, which only show here while the dialog is too narrow for the header to hold them, or why
 * there are none. They wrap onto as many lines as the width needs. Labels, update time and checks come from the board.
 */
export function ItemMeta({ item, read, now }: { item: Item; read: ItemDetailsRead; now: number }) {
  const azure = Boolean(item.repo && onAzure(item.repo));
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2" data-meta>
      {item.azure && <><Fact label="Azure type">{item.azure.type}</Fact><Fact label="Azure state">{item.azure.state}</Fact></>}
      <FromDetails read={read} label="Author" show={(d) => d.author && <Person name={d.author} />} />
      <FromDetails read={read} label="Assignees" show={(d) => d.assignees.length > 0 && <span className="flex flex-wrap gap-x-3 gap-y-1">{d.assignees.map((a) => <Person key={a} name={a} />)}</span>} />
      {item.labels.length > 0 && (
        <Fact label="Labels"><span className="flex flex-wrap gap-1" data-labels>{item.labels.map((l) => <Badge key={l} className="h-auto max-w-full whitespace-normal py-px text-start wrap-anywhere">{l}</Badge>)}</span></Fact>
      )}
      {azure
        ? <><FromDetails read={read} label="Iteration" show={(d) => d.iteration} /><FromDetails read={read} label="Area" show={(d) => d.area} /></>
        : <FromDetails read={read} label="Milestone" show={(d) => d.milestone} />}
      <FromDetails read={read} label="Created" show={(d) => d.createdAt && <When iso={d.createdAt} now={now} />} />
      <Fact label="Updated"><When iso={item.updatedAt} now={now} /></Fact>
      {item.pipeline && <ChecksBadge checks={item.pipeline.checks} counts />}
      <AgentWorkNote item={item} />
      <AgentWork item={item} className="@min-[40rem]:hidden" />
    </div>
  );
}

/** The item's sub-tickets, each a link with its open or closed mark, in a sidebar section; a placeholder while the details load, nothing once they failed or hold none. */
export function SubTickets({ read }: { read: ItemDetailsRead }) {
  if (read.state === 'failed' || (read.state === 'loaded' && read.details.subTickets.length === 0 && !read.details.relationsError)) return null;
  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <h2 className="m-0 text-[13px] font-medium">Sub-tickets</h2>
      {read.state === 'loaded' && read.details.relationsError && <p role="alert" className="m-0 text-sm text-(--error-foreground)">Could not load sub-tickets: {read.details.relationsError}</p>}
      {read.state === 'loading' ? <Placeholder className="h-4 w-24" /> : (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {read.details.subTickets.map((s) => (
            <li key={s.url} className="flex items-start gap-2 text-sm">
              {s.state === 'closed' ? <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-(--success)" /> : <CircleDot className="mt-0.5 size-3.5 shrink-0 text-(--muted-foreground)" />}
              <span className="min-w-0"><a href={s.url} target="_blank" rel="noopener" className="wrap-anywhere hover:underline"><span className="text-(--muted-foreground)">#{s.number}</span> {s.title}</a><AzureFields azure={s.azure} /></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
