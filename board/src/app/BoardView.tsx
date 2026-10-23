// The Board view: a section per group of statuses, with cards, concept blocks, List groups by
// platform and the Done list. Read-only for now; later slices wire its buttons.

import type { ReactNode } from 'react';
import { AMBER_STATUSES, STATUSES, ref, workMessage } from '../model.ts';
import type { BoardData, Item } from '../model.ts';
import { boardSections, conceptChildren } from '../board-view.ts';
import { day, plural, slug } from '../format.ts';
import { useBoardStore } from './board-store.ts';
import { AbandonButton, Card, writeState } from './Card.tsx';
import { Disclosure } from './Disclosure.tsx';
import { KindPill, LabelPills, PlatformBadge, TitleLink } from './item-parts.tsx';
import { StatsBadge, TotalBadge, shownTotal } from './stats-badges.tsx';

function Section({ id, title, count, note, children }: { id: string; title: string; count: number; note?: string; children: ReactNode }) {
  return (
    <section className="section" id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} tabIndex={-1}>{title} <span className="count">{count}</span>{note && <> <span className="note">{note}</span></>}</h2>
      {children}
    </section>
  );
}

function Cards({ items, data, empty, card = (i) => <Card item={i} data={data} key={i.id} /> }: {
  items: Item[];
  data: BoardData;
  empty: string;
  card?: (item: Item) => ReactNode;
}) {
  if (!items.length) return <p className="empty">{empty}</p>;
  return <div className="cards">{items.map(card)}</div>;
}

/** List and Done rows show every label; sub-issue rows keep the card's kind pill. */
function Row({ item, data, trailing, withPlatform = true, pills = 'labels' }: {
  item: Item;
  data: BoardData;
  trailing?: ReactNode;
  withPlatform?: boolean;
  pills?: 'labels' | 'kind';
}) {
  return (
    <li className="row-item" data-anchor={item.id}>
      {withPlatform && <PlatformBadge item={item} data={data} />}
      <TitleLink item={item} className="row-title" />
      {pills === 'labels' ? <LabelPills item={item} /> : <KindPill item={item} />}
      {trailing}
    </li>
  );
}

function ConceptBlock({ concept, data }: { concept: Item; data: BoardData }) {
  const children = conceptChildren(concept, data.items);
  const { total, completed } = concept.subIssues;
  const pct = total ? Math.round((completed / total) * 100) : 0;
  const statuses = STATUSES.filter((s) => children.some((c) => c.status === s));
  const extra = (
    <>
      <div className="progress">
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed} aria-label="Sub-issues done"><span style={{ width: `${pct}%` }} /></div>
        <span className="progress-label">{completed}/{total} sub-issues done</span>
      </div>
      {children.length ? (
        <ul className="sub-groups" aria-label="Open sub-issues by status">
          {statuses.map((s) => (
            <li className="sub-group" key={s}>
              <span className={`sub-status${AMBER_STATUSES.includes(s) ? ' amber' : ''}`}>{s}</span>
              <ul>
                {children.filter((c) => c.status === s).map((c) => (
                  <Row item={c} data={data} pills="kind" key={c.id}
                    trailing={c.blockedBy > 0 && <span className="blocked-by">blocked by {c.blockedBy}</span>} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : <p className="empty">No open sub-issues on the board.</p>}
    </>
  );
  return <Card item={concept} data={data} extra={extra} />;
}

/** Start in the card's top-right corner, or the tag of the T3 thread a page started for it. */
function StartControl({ item, data }: { item: Item; data: BoardData }) {
  const thread = data.started?.[item.id];
  return (
    <span className="start-group">
      {thread
        ? <span className="started-tag" tabIndex={-1} data-start-result={item.id} title={`T3 thread ${thread.threadId}`}>Started</span>
        // Sample mode keeps Start's menu open-able, so the model choices can be seen.
        : <button type="button" className="copy start-item" data-start={item.id} aria-label={`Start ${ref(item)} ${item.title}`} aria-haspopup="menu" aria-expanded={false}
            {...(data.capture?.enabled === false ? {} : writeState(data))}>Start {'▾'}</button>}
    </span>
  );
}

function QueuedCard({ item, data }: { item: Item; data: BoardData }) {
  const issue = Boolean(workMessage(item));
  // Issues and drafts get a footer row; nothing queues a pull request, and a started thread takes the row away.
  const footer = item.type !== 'PullRequest' && !data.started?.[item.id] && (
    <div className="card-actions">
      <button type="button" className="link-action" data-back-to-list={item.id} aria-label={`Back to List ${ref(item)} ${item.title}`} {...writeState(data)}>{'←'} Back to List</button>
      <AbandonButton item={item} data={data} className="link-action danger" />
    </div>
  );
  return (
    <Card item={item} data={data}
      action={issue && <StartControl item={item} data={data} />}
      extra={!issue && <p className="foot"><span className="hint">This draft needs an issue before it can start. Convert it to an issue in a repo.</span></p>}
      after={footer} />
  );
}

export function BoardView() {
  const { data, now } = useBoardStore();
  const { needsYou, inFlight, concepts, queued, list, listGroups, done } = boardSections(data, now);
  return (
    <>
      <Section id="needs-you" title="Needs you" count={needsYou.length} note="Needs you, Verify and Ready to merge: only you can move these">
        <Cards items={needsYou} data={data} empty="Nothing needs you right now." />
      </Section>
      <Section id="in-flight" title="In flight" count={inFlight.length} note="Shaping, Ready, In progress, Review">
        <Cards items={inFlight} data={data} empty="Nothing is being shaped, built or reviewed." />
      </Section>
      <Section id="concepts" title="Concepts" count={concepts.length}>
        {concepts.length
          ? <div className="cards wide">{concepts.map((c) => <ConceptBlock concept={c} data={data} key={c.id} />)}</div>
          : <p className="empty">No open concepts.</p>}
      </Section>
      <Section id="queued" title="Queued" count={queued.length} note="Start opens a mux-work thread in T3 Code">
        <Cards items={queued} data={data} empty="Nothing queued. Press Queue on a List item to queue it."
          card={(i) => <QueuedCard item={i} data={data} key={i.id} />} />
      </Section>
      <Section id="list" title="List" count={list.length}>
        <div className="platforms">
          {listGroups.map(({ platform, id, items }) => (
            <Disclosure className="platform" id={id} byDefault key={id}
              summary={<><span className={`plat plat-${slug(platform)}`}>{platform}</span> <b>{items.length}</b> in List</>}>
              {items.length ? (
                <ul className="rows">
                  {items.map((i) => (
                    <Row item={i} data={data} withPlatform={false} key={i.id} trailing={<>
                      <button type="button" className="copy row-action" data-queue={i.id} aria-label={`Queue ${ref(i)} ${i.title}`} {...writeState(data)}>Queue</button>
                      <AbandonButton item={i} data={data} />
                    </>} />
                  ))}
                </ul>
              ) : <p className="empty">Nothing in List.</p>}
            </Disclosure>
          ))}
        </div>
      </Section>
      <Section id="done" title="Done" count={done.length} note="last 7 days">
        <Disclosure className="platform" id="done-list" byDefault={false} summary={`Show ${plural(done.length, 'item')} closed in the last 7 days`}>
          {done.length ? (
            <ul className="rows">
              {done.map((i) => (
                <Row item={i} data={data} key={i.id} trailing={<>
                  <StatsBadge item={i} /><TotalBadge total={shownTotal(i, data)} />
                  <span className="when">{day(i.closedAt ?? i.updatedAt, undefined)}</span>
                </>} />
              ))}
            </ul>
          ) : <p className="empty">Nothing closed this week.</p>}
        </Disclosure>
      </Section>
    </>
  );
}
