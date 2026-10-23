// The Flow view: parent and sub-issue, blocked-by and blocks links as an indented outline. Only
// links GitHub records are shown; issues that aren't on the Board appear as references.

import type { MouseEvent } from 'react';
import { AMBER_STATUSES, STATUSES, isBuild, isOnBoard } from '../model.ts';
import type { BoardData, IssueLinks, IssueRef, Item } from '../model.ts';
import { plural } from '../format.ts';
import { useBoardStore } from './board-store.ts';
import { Disclosure } from './Disclosure.tsx';
import { KindPill, PlatformBadge, TitleLink } from './item-parts.tsx';
import { jumpTo } from './jump.ts';

function issueKey(repo: string | null, number: number | null): string | null {
  return repo && number !== null ? `${repo}#${number}` : null;
}

function outlineOrder(a: Item, b: Item): number {
  return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || (a.number ?? 0) - (b.number ?? 0);
}

const parentKey = (i: Item) => (i.parent ? issueKey(i.parent.repo, i.parent.number) : null);

const related = (i: Item) => Boolean(i.parent || i.subIssues.total || i.slices.length || i.blockers.total || i.blocking.total);

/** "done/total noun done", or '' with nothing to count. A build counts its visible slices, which leave out those closed as not planned. */
function subsDone(item: Item): string {
  const [done, total, noun] = isBuild(item)
    ? [item.slices.filter((s) => s.progress === 'done').length, item.slices.length, 'slices']
    : [item.subIssues.completed, item.subIssues.total, 'sub-issues'];
  return total ? `${done}/${total} ${noun} done` : '';
}

/** `#n` within the same repo, `repo#n` across repos. */
function shortRef(r: IssueRef, from: string | null): string {
  return r.repo === from ? `#${r.number}` : `${r.repo.split('/')[1]}#${r.number}`;
}

/** The items Flow shows, by issue key, and each one's sub-issues on the board. */
interface Outline {
  data: BoardData;
  shown: Map<string, Item>;
  children: Map<string, Item[]>;
}

function StatusChip({ item }: { item: Item }) {
  const tone = AMBER_STATUSES.includes(item.status) ? ' amber' : item.status === 'Done' ? ' done' : '';
  return <span className={`o-status${tone}`}>{item.status}</span>;
}

function jump(event: MouseEvent, itemId: string): void {
  // An in-page link: keep it out of the hash, which picks the view.
  event.preventDefault();
  jumpTo(document.getElementById(`o-${itemId}`));
}

/** A Board item jumps to its own row; anything else is a dashed reference to GitHub with its state. */
function IssueRefLink({ issue, from, outline }: { issue: IssueRef; from: string | null; outline: Outline }) {
  const item = outline.shown.get(issueKey(issue.repo, issue.number)!);
  const label = <><b>{shortRef(issue, from)}</b> {issue.title}</>;
  if (item) return <><a className="o-ref" href="#flow" data-outline-jump={item.id} onClick={(event) => jump(event, item.id)}>{label}</a> <StatusChip item={item} /></>;
  return <><a className="o-ref off" href={issue.url} target="_blank" rel="noopener">{label}</a> <span className="o-off">not on board · {issue.state === 'OPEN' ? 'open' : 'closed'}</span></>;
}

/** One row per link GitHub returned, then a count of the rest. */
function linkRows(rel: 'blocked by' | 'blocks', links: IssueLinks, from: string | null, outline: Outline) {
  const cls = `o-link ${rel === 'blocked by' ? 'o-blocked-by' : 'o-blocks'}`;
  const rows = links.nodes.map((r) => (
    <li className={cls} key={`${rel}-${r.repo}#${r.number}`}><span className="o-rel">{rel}</span> <IssueRefLink issue={r} from={from} outline={outline} /></li>
  ));
  const more = links.total - links.nodes.length;
  if (more > 0) rows.push(<li className={`${cls} o-more`} key={`${rel}-more`}><span className="o-rel">{rel}</span> {plural(more, 'more issue', 'more issues')}</li>);
  return rows;
}

function OutlineNode({ item, outline }: { item: Item; outline: Outline }) {
  const kids = outline.children.get(issueKey(item.repo, item.number) ?? '') ?? [];
  // A build's slices are never board items and aren't in its sub-issue counts, so none is missing.
  const missing = item.subIssues.total - kids.length;
  const links = [...linkRows('blocked by', item.blockers, item.repo, outline), ...linkRows('blocks', item.blocking, item.repo, outline)];
  const count = subsDone(item);
  return (
    <li className="o-node" id={`o-${item.id}`}>
      <div className="o-row" data-anchor={`o:${item.id}`}>
        <PlatformBadge item={item} data={outline.data} /><KindPill item={item} /><TitleLink item={item} className="o-title" /><StatusChip item={item} />
        {count && <span className="o-subs">{count}</span>}
      </div>
      {links.length > 0 && <ul className="o-links">{links}</ul>}
      {(kids.length > 0 || missing > 0) && (
        <ul className="o-tree">
          {kids.map((kid) => <OutlineNode key={kid.id} item={kid} outline={outline} />)}
          {missing > 0 && <li className="o-missing">{plural(missing, 'more sub-issue')} not on the board</li>}
        </ul>
      )}
    </li>
  );
}

export function FlowView() {
  const { data, now } = useBoardStore();
  const items = data.items.filter((i) => isOnBoard(i, now)).sort(outlineOrder);
  const shown = new Map(items.flatMap((i) => {
    const key = issueKey(i.repo, i.number);
    return key ? [[key, i] as const] : [];
  }));
  const children = new Map<string, Item[]>();
  for (const i of items) {
    const key = parentKey(i);
    if (key) children.set(key, [...(children.get(key) ?? []), i]);
  }
  const outline: Outline = { data, shown, children };

  const roots: Item[] = [];
  const offBoard = new Map<string, { parent: IssueRef; kids: Item[] }>();
  for (const i of items.filter(related)) {
    const key = parentKey(i);
    if (!key) roots.push(i);
    else if (!shown.has(key)) offBoard.set(key, { parent: i.parent!, kids: [...(offBoard.get(key)?.kids ?? []), i] });
  }
  const loose = items.filter((i) => !related(i));

  return (
    <div className="outline">
      <ul className="o-legend" aria-label="Legend">
        <li><span className="o-rel">nested</span> sub-issue of the row above</li>
        <li><span className="o-rel">blocked by</span> GitHub's blocked-by link</li>
        <li><span className="o-rel">blocks</span> GitHub's blocking link</li>
        <li><span className="o-ref off">dashed</span> not on the board, shown as a reference</li>
      </ul>
      <ul className="o-tree o-root">
        {roots.map((i) => <OutlineNode key={i.id} item={i} outline={outline} />)}
        {[...offBoard].map(([key, { parent, kids }]) => (
          <li className="o-node o-offroot" key={key}>
            <div className="o-row"><IssueRefLink issue={parent} from={null} outline={outline} /></div>
            <ul className="o-tree">{kids.map((kid) => <OutlineNode key={kid.id} item={kid} outline={outline} />)}</ul>
          </li>
        ))}
      </ul>
      <Disclosure className="platform o-loose" id="flow-loose" byDefault={false} summary={`${plural(loose.length, 'item')} with no recorded relationships`}>
        <ul className="rows">
          {loose.map((i) => (
            <li className="row-item" data-anchor={`o:${i.id}`} key={i.id}><PlatformBadge item={i} data={data} /><TitleLink item={i} className="row-title" /><StatusChip item={i} /></li>
          ))}
        </ul>
      </Disclosure>
    </div>
  );
}
