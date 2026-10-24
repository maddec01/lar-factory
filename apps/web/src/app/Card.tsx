// A Board card: badges, title, parent, the status bar (and a build's slice bar), PR links with
// their checks, and the item stats.

import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { AMBER_STATUSES, STATUSES } from '../../../server/src/model.ts';
import type { BoardData, Item, LinkedPr, Status } from '../../../server/src/model.ts';
import { HINTS, checksBadge, namedSlices, prLabel, statusTone } from '../../../server/src/board-view.ts';
import { plural } from '../../../server/src/format.ts';
import type { ItemAction } from './action-store.ts';
import { useBoardStore } from './board-store.ts';
import { SlicePopover, sliceKey } from './SlicePopover.tsx';
import { KindPill, PlatformBadge, TitleLink } from './item-parts.tsx';
import { StatsBadge, TotalBadge, shownTotal } from './stats-badges.tsx';

/** Ten segments, one per status, with the item's current status coloured, then its caption: two cells of a `.bars` grid. */
function StepCells({ status }: { status: Status }) {
  const at = STATUSES.indexOf(status);
  const tone = statusTone(status);
  return (
    <>
      <ol className="segbar steps" aria-hidden="true">
        {STATUSES.map((s, i) => <li className={i < at ? 'past' : i === at ? `cur ${tone}` : 'next'} title={s} key={s} />)}
      </ol>
      <span className={`bar-label step-label ${tone}`}>{at + 1}/{STATUSES.length} · {status}</span>
    </>
  );
}

const Sep = () => <span className="sep"> · </span>;

/**
 * The status bar, and on a build with slices its slice bar under it: one segment per slice, the
 * captions sharing a column, and one line naming the blocked or the active slices (counting them
 * when both are present). The slices are listed in a popover that floats over the board.
 */
function Bars({ item }: { item: Item }) {
  const slices = item.slices;
  if (!slices.length) return <div className="bars"><StepCells status={item.status} /></div>;
  const done = slices.filter((s) => s.progress === 'done').length;
  const groups = namedSlices(slices);
  // Both groups together show counts only, so the active ones never truncate away.
  const named = groups.map(({ progress, slices: group }, g) => (
    <Fragment key={progress}>
      {g > 0 && <Sep />}
      <span className={`slices-${progress}`}>{group.length} {progress}</span>
      {groups.length === 1 && group.map((s, i) => <Fragment key={sliceKey(s)}>{i > 0 ? <Sep /> : ' '}<span className="ref">#{s.number}</span> {s.title}</Fragment>)}
    </Fragment>
  ));
  return (
    <SlicePopover item={item}>
      <div className="bars">
        <StepCells status={item.status} />
        <ol className="segbar slice-bar" aria-hidden="true">{slices.map((s) => <li className={s.progress} key={sliceKey(s)} />)}</ol>
        <span className="bar-label">{done}/{slices.length} · Slices done</span>
      </div>
      {named.length > 0 && <p className="slices-now">{named}</p>}
    </SlicePopover>
  );
}

function ChecksBadge({ pr }: { pr: LinkedPr }) {
  const now = useBoardStore((state) => state.now);
  const badge = checksBadge(pr, now);
  if (!badge) return null;
  return <span className={badge.className} title={badge.title}>{badge.text}{badge.slow && <span className="sr-only"> (running over 30 minutes)</span>}</span>;
}

/** Board writes are off in sample mode, so its buttons are too; an action in flight holds them. */
export function writeState(data: BoardData, action?: ItemAction): { disabled?: true; title?: string; 'aria-disabled'?: true } {
  if (data.capture?.enabled === false) return { disabled: true, title: 'Disabled in sample mode' };
  return action?.phase === 'pending' ? { 'aria-disabled': true } : {};
}

/** `action` sits in the card's top row, so it adds no height; `after` is a row below the item stats. */
export function Card({ item, data, extra, action, after }: { item: Item; data: BoardData; extra?: ReactNode; action?: ReactNode; after?: ReactNode }) {
  const hint = HINTS[item.status];
  const total = shownTotal(item, data);
  return (
    <article className={`card${AMBER_STATUSES.includes(item.status) ? ' amber' : ''}`} data-anchor={item.id}>
      <div className="meta">
        <span className="badges">
          <PlatformBadge item={item} data={data} /><KindPill item={item} />
          {item.blockedBy > 0 && <span className="blocked-by" title={`Blocked by ${plural(item.blockedBy, 'issue')}`}>blocked by {item.blockedBy}</span>}
          {/* A build's slices aren't counted here: its slice bar shows them. */}
          {item.subIssues.total > 0 && <span className="subs">{item.subIssues.completed}/{item.subIssues.total} sub-issues</span>}
        </span>
        {action}
      </div>
      <TitleLink item={item} />
      {item.parent && <p className="parent">Part of <a href={item.parent.url} target="_blank" rel="noopener">#{item.parent.number} {item.parent.title}</a></p>}
      <Bars item={item} />
      {(hint || item.linkedPrs.length > 0) && (
        <p className="foot">
          {hint && <span className="hint">{hint}</span>}
          {item.linkedPrs.map((pr) => (
            <span className="linked-pr" key={pr.number}><a className="pr" href={pr.url} target="_blank" rel="noopener">{prLabel(pr)}</a><ChecksBadge pr={pr} /></span>
          ))}
        </p>
      )}
      {extra}
      {(item.stats || total) && <p className="card-stats"><StatsBadge item={item} /><TotalBadge total={total} /></p>}
      {after}
    </article>
  );
}
