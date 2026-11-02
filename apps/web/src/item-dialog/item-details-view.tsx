// What the item dialog shows from an item's details: the description and comments in its main column, the people,
// kind control, labels and their picker, dates, milestone or iteration and area in the meta area under its title, and the
// sub-tickets in its sidebar. While the details load each shows a placeholder, and a failed read shows its error in the
// description's place; the board's own fields never wait. Once they load, Edit opens the description editor in the
// description's place, with Save and Cancel under it; the extra sections, such as Acceptance Criteria, stay read-only.
// Beside a work record's own text, the description and comments are the ticket's context and say so.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, CircleDot, Lock, Pencil } from 'lucide-react';
import { STRUCTURE_LABEL, SWAP_KINDS, kindCanChange, kindLabels, kindSwapAccessProblem, onAzure, sameRepo, shortAgo, trackerCapabilities, writeAccessProblem } from '@lar-factory/shared';
import type { IssueRef, Item, ItemComment, ItemDetails, KindTicketSwap, SwapKind, TextFormat } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { FormSelect } from '@lar-factory/ui/form-select';
import { Popover } from '@lar-factory/ui/design-system/Popover';
import { RichText } from '@lar-factory/ui/rich-text';
import { MarkdownDiagrams } from '../diagrams/markdown-diagrams.tsx';
import { DescriptionEditor } from '../description-editor/description-editor.tsx';
import { AzureFields, AgentWork, AgentWorkNote, KIND_BADGES, LabelChips, useShownLabels } from '../items/item-parts.tsx';
import { LabelPicker } from '../labels/label-picker.tsx';
import { useBoardStore } from '../board/board-store.ts';
import type { DescriptionEdit } from './use-description-edit.ts';
import { useKindChangeStore } from './kind-change-store.ts';
import { OPEN_ITEM_DIALOG } from './item-dialog-store.ts';
import { useLabelEdit } from './use-label-edit.ts';
import type { ItemDetailsRead } from './use-item-details.ts';
import { useOlderComments } from './use-older-comments.ts';
import type { DetailsEntry } from './details-cache.ts';
import { postAction } from '../items/card-actions.ts';
import { detailsCache } from './details-cache.ts';
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

/** The comments, newest first: the latest the details hold, then each older page fetched. Remounts with each open of the dialog. */
function Comments({ itemId, entry, now, ticketContext, className }: { itemId: string; entry: DetailsEntry; now: number; ticketContext: boolean; className: string }) {
  const older = useOlderComments(itemId, entry);
  const comments = [...entry.details.comments, ...older.comments];
  return (
    <div className={`grid min-w-0 gap-2 ${className}`} data-comments>
      <Heading>{ticketContext ? 'Ticket comments' : 'Comments'}{comments.length > 0 && ` · ${comments.length}`}</Heading>
      {comments.length > 0
        ? <ol className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-3 p-0">{comments.map((c) => <Comment key={c.id} comment={c} now={now} />)}</ol>
        : !older.hasMore && <p className="m-0 text-sm text-(--muted-foreground)">No comments.</p>}
      {older.hasMore && (
        <div className="flex flex-wrap items-center gap-3">
          <Button {...kind('other')} loading={older.loading} onClick={older.loadMore}>Load older comments</Button>
          {older.error && <p className="m-0 text-xs text-(--error-foreground)" role="alert">Could not load older comments: {older.error}</p>}
        </div>
      )}
    </div>
  );
}

/** The description editor on `body`, then whether it changed or why its save failed, Cancel and Save. */
function EditDescription({ body, format, edit, fill }: { body: string; format: TextFormat; edit: DescriptionEdit; fill: boolean }) {
  return <>
    <div className={fill ? 'flex min-h-0 flex-col' : 'contents'}>
      <DescriptionEditor label="Description" placeholder="Add a description…" value={body} format={format} autoFocus
        onBaseline={edit.setBaseline} onChange={edit.change} disabled={edit.saving} fill={fill} />
    </div>
    {/* A save error takes the status's place and wraps under it, so Cancel and Save stay where they were. */}
    <div className="flex items-start gap-2" data-edit-actions>
      {edit.error
        ? <p className="m-0 me-auto min-w-0 flex-1 py-1.5 text-xs text-(--error-foreground)" role="alert">{edit.error}</p>
        : <span className="me-auto min-w-0 flex-1 py-1.5 text-xs text-(--muted-foreground)">{edit.dirty ? 'Unsaved changes' : 'No changes'}</span>}
      <Button {...kind('other')} disabled={edit.saving} onClick={edit.cancel}>Cancel</Button>
      <Button {...kind('main')} disabled={!edit.dirty} loading={edit.saving} onClick={() => void edit.save()}>Save</Button>
    </div>
  </>;
}

function SpecNotice({ itemId, spec, refresh }: { itemId: string; spec: NonNullable<ItemDetails['spec']>; refresh: () => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: 'retry' | 'accept' | 'reject') => {
    setBusy(true); setError(null);
    const result = await postAction('/api/item-spec', { itemId, generation: spec.generation, action });
    if (result.error) setError(result.error);
    else { detailsCache.drop(itemId); if (!await refresh()) setError('Could not reload the Spec. Reopen the item to read it.'); }
    setBusy(false);
  };
  return <div className="grid gap-2 text-sm" data-spec-sync>
    {(spec.error || spec.warning || spec.pending) && <p className="m-0" role="status">{spec.warning ?? spec.error ?? 'The Spec is waiting to save to the tracker.'}</p>}
    {spec.held ? <>
      <details><summary className="cursor-pointer">Review held GitHub edit</summary><h3>{spec.held.title}</h3><RichText text={spec.held.body} format="markdown" /></details>
      <div className="flex gap-2"><Button {...kind('other')} disabled={busy} onClick={() => void act('accept')}>Accept edit</Button><Button {...kind('other')} disabled={busy} onClick={() => void act('reject')}>Reject edit</Button></div>
    </> : (spec.pending || spec.error) && <Button {...kind('other')} loading={busy} onClick={() => void act('retry')}>Retry Spec sync</Button>}
    {error && <p className="m-0 text-(--error-foreground)" role="alert">{error}</p>}
  </div>;
}

const RELOAD_FAILED = 'Saved; could not reload the details';

/**
 * The description, or the loading state or the error that stands in for it. Edit shows when `editable`, as this Mac
 * lets the factory edit the repository's tickets. While `edit` is open the editor takes the description's place,
 * filling the height left when `fill`.
 */
export function ItemDescription({ itemId, refresh, read, edit, editable, fill, ticketContext = false, className }: { itemId: string; refresh: () => Promise<boolean>; read: ItemDetailsRead; edit: DescriptionEdit; editable: boolean; fill: boolean; ticketContext?: boolean; className: string }) {
  if (read.state === 'loading') return <div className={className}><Loading /></div>;
  if (read.state === 'failed') return <p className={`m-0 text-sm text-(--error-foreground) ${className}`} role="alert">Could not load the details: {read.error}</p>;
  const { sections } = read.details;
  // A save the details could not be read back after stands for the description until they are.
  const [body, format]: [string, TextFormat] = edit.saved === null ? [read.details.body, read.details.format] : [edit.saved, 'markdown'];
  return (
    <div className={`grid min-w-0 gap-2 ${fill ? 'min-h-0 grid-rows-[auto_minmax(0,1fr)]' : ''} ${className}`} data-description>
      <div className="flex h-7 items-center justify-between gap-2">
        <h2 className="m-0 text-[11px] font-medium uppercase tracking-wider text-(--muted-foreground)">{read.details.spec ? 'Spec' : ticketContext ? 'Ticket description' : 'Description'}</h2>
        {!edit.editing && <span className="flex min-w-0 items-center gap-3">
          {edit.saved !== null && <span className="truncate text-xs text-(--muted-foreground)" role="status" title={RELOAD_FAILED}>{RELOAD_FAILED}</span>}
          {editable && <Button {...kind('other')} leftIcon={<Pencil />} onClick={edit.start}>Edit</Button>}
        </span>}
      </div>
      {read.details.spec && <SpecNotice itemId={itemId} spec={read.details.spec} refresh={refresh} />}
      {edit.editing
        ? <EditDescription body={body} format={format} edit={edit} fill={fill} />
        : body ? <>{format === 'markdown' ? <MarkdownDiagrams text={body} /> : <RichText text={body} format={format} />}</> : <p className="m-0 text-sm text-(--muted-foreground)">No description.</p>}
      {read.details.spec?.original && <details><summary className="cursor-pointer text-sm text-(--muted-foreground)">Original</summary><RichText text={read.details.spec.original} format={read.details.spec.originalFormat} /></details>}
      {sections?.map((section) => <section key={section.title} className="grid min-w-0 gap-2"><Heading>{section.title}</Heading><RichText text={section.body} format={section.format} /></section>)}
    </div>
  );
}

/** The comments, newest first; none while the details load or when the read failed. */
export function ItemComments({ itemId, read, now, ticketContext = false, className }: { itemId: string; read: ItemDetailsRead; now: number; ticketContext?: boolean; className: string }) {
  return read.state === 'loaded' ? <Comments itemId={itemId} entry={read.entry} now={now} ticketContext={ticketContext} className={className} /> : null;
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

const LABEL_ERROR = 'm-0 text-xs text-(--error-foreground)';

/**
 * The tracker's labels on the item, without those its row hides, and the picker that adds and removes them; linked-work
 * shows only as a note, for the factory owns it. Without access the control is disabled with the reason. Local work has no labels.
 */
function ItemLabels({ item }: { item: Item }) {
  const shown = useShownLabels(item);
  const setup = useBoardStore((state) => state.data.repos.find((r) => sameRepo(r.repo, item.repo))?.setup);
  const edit = useLabelEdit(item);
  const [open, setOpen] = useState(false);
  const { heading, noun } = trackerCapabilities(item.repo);
  if (!item.number) return <p data-local-labels className="m-0 text-xs text-(--muted-foreground)">Local work has no ticket, so it has a kind alone. Create a ticket to add {noun}s.</p>;
  const linked = item.labels.some((l) => l.toLowerCase() === STRUCTURE_LABEL);
  const problem = writeAccessProblem(item.repo, 'tag-ticket', setup?.access ?? {}, { azureReadOnly: setup?.azureReadOnly });
  const openChange = (next: boolean) => {
    setOpen(next);
    if (next) void edit.read();
  };
  return (
    <Fact label={heading}>
      <span className="flex flex-wrap items-center gap-1">
        {(shown.length > 0 || linked) && <span className="contents" data-labels>
          <LabelChips item={item} />
          {linked && <span data-locked-label title="The factory manages this for saved links, so it can't be edited." className="inline-flex items-center gap-1 text-xs text-(--muted-foreground)"><Lock className="size-3 shrink-0" aria-hidden="true" />{STRUCTURE_LABEL}</span>}
        </span>}
        <Popover open={open} onOpenChange={openChange}>
          <Popover.Trigger asChild>
            <button type="button" data-edit-labels disabled={problem !== null} title={problem ?? undefined} aria-label={`Edit ${heading.toLowerCase()}`}
              className="grid size-5 place-items-center rounded text-(--muted-foreground) hover:bg-(--accent) disabled:opacity-50 disabled:hover:bg-transparent"><Pencil className="size-3" /></button>
          </Popover.Trigger>
          <Popover.Content side="bottom" align="start">
            <div className="grid w-72 gap-2">
              {edit.choices
                ? <LabelPicker heading={heading} choices={edit.choices} picked={item.labels} locked={kindLabels(item.kind, setup?.vocabulary)} busy={edit.saving} onToggle={(name) => void edit.toggle(name)} />
                : !edit.error && <p role="status" className="m-0 text-xs text-(--muted-foreground)">Reading {noun}s…</p>}
              {edit.error && <p role="alert" className={LABEL_ERROR}>{edit.error}</p>}
            </div>
          </Popover.Content>
        </Popover>
        {edit.error && !open && <span role="alert" className={LABEL_ERROR}>{edit.error}</span>}
      </span>
    </Fact>
  );
}

const KIND_CHOICES = SWAP_KINDS.map((value) => {
  const { name, icon: Icon } = KIND_BADGES[value]!;
  return { value, name, icon: <Icon aria-hidden="true" /> };
});

/**
 * The control that changes an ordinary item's kind, and what the last change did: the line it answered with, or why it stopped,
 * what it changed on the ticket before that, and Retry for the same change. Concepts, decisions and builds don't have it.
 * A write disables this control and takes away the button that answered, which drops focus to the page or the dialog, so it comes
 * back here when the write ends. A control the user has moved to since keeps it.
 */
function ItemKindControl({ item }: { item: Item }) {
  const change = useKindChangeStore((state) => state.changes[item.id]);
  const saving = useKindChangeStore((state) => Boolean(state.changes[item.id]?.saving || state.answers[item.id]?.saving));
  const control = useRef<HTMLButtonElement>(null);
  const wasSaving = useRef(false);
  useEffect(() => {
    if (wasSaving.current && !saving && (document.activeElement === document.body || document.activeElement?.matches(OPEN_ITEM_DIALOG))) control.current?.focus();
    wasSaving.current = saving;
  }, [saving]);
  const { start } = useKindChangeStore.getState();
  if (!kindCanChange(item.kind)) return null;
  return <>
    <Fact label="Kind">
      <span className="block w-44" data-item-kind-control>
        <FormSelect ref={control} writesOnPick aria-label="Kind" placeholder="No kind" value={item.kind === 'issue' ? '' : item.kind} choices={KIND_CHOICES} disabled={change?.saving} onChange={(kind) => void start(item.id, kind as SwapKind)} />
      </span>
    </Fact>
    {change?.error
      ? <div role="alert" data-kind-change-failed className="grid w-full justify-items-start gap-1 text-xs text-(--error-foreground)">
        <p className="m-0">{change.error}</p>
        <p className="m-0">{change.line ? `Changed on the ticket so far: ${change.line}` : 'Nothing changed on the ticket.'}</p>
        <Button {...kind('other')} loading={change.saving} onClick={() => void start(item.id, change.kind)}>Retry</Button>
      </div>
      : change?.line && <p role="status" data-kind-change-line className="m-0 w-full text-xs text-(--muted-foreground)">{change.line}</p>}
  </>;
}

const kindName = (value: SwapKind) => KIND_BADGES[value]!.name;
const NOTICE_HINT = 'm-0 text-xs text-(--muted-foreground)';

/** What an update changes on the ticket, in the tracker's own words, and `note`, what it leaves alone and why. */
function swapLine(item: Item, { add, remove, type }: KindTicketSwap, note: string): string {
  const { noun } = trackerCapabilities(item.repo);
  const parts = [...add.length || remove.length ? [`${noun} ${remove.join(', ') || 'none'} → ${add.join(', ') || 'none'}`] : [], ...type ? [`type ${type.from ?? 'none'} → ${type.to}`] : []];
  if (parts.length) return `Update changes #${item.number}: ${parts.join(', ')}.${note}`;
  return note ? `Update writes nothing to #${item.number}.${note}` : `Update writes nothing to #${item.number}, as ${kindName(item.kind as SwapKind)} has no mapped ${noun} or type.`;
}

/**
 * How the item's kind and its ticket's disagree and the two answers, worded from whichever side moved. A kept answer holds until
 * either kind changes and leaves a line whose Change shows the choice again here, with the answer standing until a new one replaces it.
 * What an update writes comes from the details, which know the team's backlog, and only while their plan is for the kinds on show. Otherwise
 * they are read again once for these kinds, and Update waits. The board's own read can't say, so it stands in only if that finds no plan.
 */
function KindNotice({ item, read, refresh }: { item: Item; read: ItemDetailsRead; refresh: () => Promise<boolean> }) {
  const disagreement = item.kindDisagreement;
  const saving = useKindChangeStore((state) => state.changes[item.id]?.saving);
  const answering = useKindChangeStore((state) => state.answers[item.id]);
  const setup = useBoardStore((state) => state.data.repos.find((r) => sameRepo(r.repo, item.repo))?.setup);
  const [reopened, setReopened] = useState(false);
  const [readFor, setReadFor] = useState<string | null>(null);
  const kinds = `${item.kind} ${disagreement?.ticketKind}`;
  const held = read.state === 'loaded' ? read.details.kindPlan : undefined;
  const plan = held?.itemKind === item.kind && held.ticketKind === disagreement?.ticketKind ? held : undefined;
  const planStale = disagreement?.changed === 'item' && (!disagreement.kept || reopened) && read.state === 'loaded' && !plan && readFor !== kinds;
  useEffect(() => {
    if (!planStale) return;
    let current = true;
    detailsCache.drop(item.id);
    void refresh().then(() => { if (current) setReadFor(kinds); });
    return () => { current = false; };
  }, [planStale, kinds, item.id, refresh]);
  if (!disagreement) return null;
  const { ticketKind, changed, kept } = disagreement;
  const { swap, note } = plan ?? { swap: disagreement.swap, note: '' };
  const { start, answer } = useKindChangeStore.getState();
  if (kept && !reopened) {
    return <p data-kind-kept className={`${NOTICE_HINT} w-full`}>{ticketKind ? `Ticket says ${kindName(ticketKind)}. Kept as is.` : 'Ticket has no kind. Left as is.'}{' '}
      <button type="button" className="underline underline-offset-2 hover:text-(--foreground)" onClick={() => setReopened(true)}>Change</button></p>;
  }
  const mine = kindName(item.kind as SwapKind);
  const said = ticketKind && kindName(ticketKind);
  const keep = () => { setReopened(false); void answer(item.id, 'keep', ticketKind); };
  const busy = saving || answering?.saving;
  const ticketMoved = changed === 'ticket' && said !== null;
  const checking = !ticketMoved && (read.state === 'loading' || planStale);
  const shaped = `Shaping decided this is ${mine === 'Improvement' ? 'an' : 'a'} ${mine}.`;
  const problem = ticketMoved ? null : kindSwapAccessProblem(item.repo, swap, setup?.access ?? {}, { azureReadOnly: setup?.azureReadOnly });
  return (
    <div data-kind-notice className="grid w-full gap-2 rounded-lg border border-(--border) p-3">
      <p className="m-0 text-sm">{ticketMoved ? `The ticket now says ${said}. This item still says ${mine}.` : `${shaped} ${said ? `The ticket still says ${said}.` : 'The ticket has no kind.'}`}</p>
      <span className="flex flex-wrap gap-2">
        {ticketMoved
          ? <Button {...kind('other')} disabled={busy} onClick={() => void answer(item.id, 'update-item', ticketKind)}>Update item to {said}</Button>
          : <Button {...kind('other')} disabled={busy || checking || problem !== null} onClick={() => void start(item.id, item.kind as SwapKind)}>{said ? `Update ticket to ${mine}` : `Add ${mine} to ticket`}</Button>}
        <Button {...kind('other')} disabled={busy} onClick={keep}>{ticketMoved ? `Keep item as ${mine}` : said ? `Keep ticket as ${said}` : 'Leave ticket as is'}</Button>
      </span>
      <p data-kind-notice-hint className={NOTICE_HINT}>{ticketMoved ? 'Changes this item only. Nothing is written to the ticket.' : checking ? 'Checking what the update changes…' : problem ?? swapLine(item, swap, note)}</p>
      {answering?.error && <p role="alert" className={LABEL_ERROR}>{answering.error}</p>}
    </div>
  );
}

/**
 * The meta area under the title: author, assignees, labels, milestone or iteration and area, dates, a pull request item's
 * checks, and the agent work figures, which only show here while the dialog is too narrow for the header to hold them, or why
 * there are none. They wrap onto as many lines as the width needs. Labels, update time and checks come from the board.
 */
export function ItemMeta({ item, read, refresh, now }: { item: Item; read: ItemDetailsRead; refresh: () => Promise<boolean>; now: number }) {
  const azure = Boolean(item.repo && onAzure(item.repo));
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2" data-meta>
      {item.azure && <><Fact label="Azure type">{item.azure.type}</Fact><Fact label="Azure state">{item.azure.state}</Fact></>}
      <FromDetails read={read} label="Author" show={(d) => d.author && <Person name={d.author} />} />
      <FromDetails read={read} label="Assignees" show={(d) => d.assignees.length > 0 && <span className="flex flex-wrap gap-x-3 gap-y-1">{d.assignees.map((a) => <Person key={a} name={a} />)}</span>} />
      <ItemKindControl item={item} />
      <ItemLabels key={item.id} item={item} />
      {azure
        ? <><FromDetails read={read} label="Iteration" show={(d) => d.iteration} /><FromDetails read={read} label="Area" show={(d) => d.area} /></>
        : <FromDetails read={read} label="Milestone" show={(d) => d.milestone} />}
      <FromDetails read={read} label="Created" show={(d) => d.createdAt && <When iso={d.createdAt} now={now} />} />
      <Fact label="Updated"><When iso={item.updatedAt} now={now} /></Fact>
      <AgentWorkNote item={item} />
      <AgentWork item={item} className="@min-[40rem]:hidden" />
      <KindNotice key={`${item.id} notice`} item={item} read={read} refresh={refresh} />
    </div>
  );
}

/** Named work item links share the child list's native fields and completion marks. */
function TicketLinks({ tickets }: { tickets: IssueRef[] }) {
  return <ul className="m-0 grid list-none gap-1.5 p-0">{tickets.map((s) => (
    <li key={s.url} className="flex items-start gap-2 text-sm">
      {s.state === 'closed' ? <CircleCheck aria-label="Done" className="mt-0.5 size-3.5 shrink-0 text-(--success)" /> : <CircleDot aria-label="Open" className="mt-0.5 size-3.5 shrink-0 text-(--muted-foreground)" />}
      <span className="min-w-0"><a href={s.url} target="_blank" rel="noopener" className="wrap-anywhere hover:underline"><span className="text-(--muted-foreground)">#{s.number}</span> {s.title}</a><AzureFields azure={s.azure} /></span>
    </li>
  ))}</ul>;
}

function RelationSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2"><h2 className="m-0 text-[13px] font-medium">{title}</h2>{children}</section>;
}

/** Children, named attachments, blockers and Related work; a failed relation read leaves the description intact. */
export function ItemRelations({ item, read }: { item: Item; read: ItemDetailsRead }) {
  if (read.state === 'failed') return null;
  if (read.state === 'loading') return <RelationSection title="Sub-tickets"><Placeholder className="h-4 w-24" /></RelationSection>;
  const { subTickets, attachments, blockers, related, relationsError } = read.details;
  const sprint = item.currentSprint;
  const current = sprint ? subTickets.filter((s) => sprint.childNumbers.includes(s.number)) : subTickets;
  const other = sprint ? subTickets.filter((s) => !sprint.childNumbers.includes(s.number)) : [];
  return <>
    {relationsError && <p role="alert" className="m-0 text-sm text-(--error-foreground)">Could not load linked work items: {relationsError}</p>}
    {subTickets.length > 0 && <RelationSection title={sprint ? 'Children' : 'Sub-tickets'}>
      {sprint && <div className="text-sm"><p className="m-0 font-medium">This sprint: {current.filter((s) => s.state === 'closed').length} of {current.length} done</p><p className="m-0 text-xs text-(--muted-foreground)">{sprint.name}</p></div>}
      <TicketLinks tickets={current} />
      {other.length > 0 && <details className="grid min-w-0 gap-2"><summary className="cursor-pointer text-sm text-(--muted-foreground)">Other children ({other.length})</summary><div className="pt-2"><TicketLinks tickets={other} /></div></details>}
    </RelationSection>}
    {Boolean(attachments?.length) && <RelationSection title="Attachments"><ul className="m-0 grid list-none gap-1.5 p-0">{attachments!.map((a) => <li key={a.url} className="text-sm"><a href={a.url} target="_blank" rel="noopener" className="wrap-anywhere underline">{a.name}</a></li>)}</ul></RelationSection>}
    {Boolean(blockers?.length) && <RelationSection title="Blocked by"><TicketLinks tickets={blockers!} /></RelationSection>}
    {Boolean(related?.length) && <RelationSection title="Related work"><TicketLinks tickets={related!} /></RelationSection>}
  </>;
}
