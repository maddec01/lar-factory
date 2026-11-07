// What keeps a dossier's work moving, as the labelled rows its Attention lists.

import { needsAnswer, openQuestionThread, itemName, ref, workingAgain } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Ban, Check, CircleHelp } from '@lar-works/design-system/icons';

import { Refs, PartLink, Entry } from './DossierEntries';
import { open, waitsOn } from './DossierHelpers';
import type { FindRef } from './DossierHelpers';
import { DECISION_KINDS, isDone, openWaits, partLabel } from './DossierParts';
import type { Part } from './DossierParts';
import { PartStart, startable } from './PartStart';
import { dependenciesOf, shownStatus, useActivityUnavailable, OpenThread } from '@/features/items';

/** The attention rows with entries: parts in Needs you, parts in Verify or Ready to merge, open decisions, blocked
 *  slices, parts waiting on others, parts ready to start, Dependencies, met or not, and the map's fog; with `only`,
 *  just those rows. */
export function useAttentionRows(
    parent: Item,
    parts: Part[],
    data: BoardData,
    find: FindRef,
    only: readonly string[] | undefined,
) {
    const unavailable = useActivityUnavailable();
    const unfinished = parts.filter((p) => !isDone(p.item));
    const ahead = only ? [] : unfinished;
    const holds = unfinished.flatMap((part) => dependenciesOf(part.item).map((hold) => ({ part, hold })));
    // A map's line naming a Dependency the records hold says less than the record, so it goes.
    const written = (parent.map?.dependencies ?? []).filter(
        (d) => !holds.some(({ hold }) => hold.need && d.toLowerCase().includes(hold.need.toLowerCase())),
    );
    const blocked = ahead.flatMap((part) =>
        part.item.slices.filter((s) => s.progress === 'blocked').map((slice) => ({ part, slice })),
    );
    const rows = [
        {
            key: 'you',
            label: 'Needs you',
            tone: 'text-(--warning-foreground)',
            entries: [
                ...(needsAnswer(parent)
                    ? [
                          <Entry
                              key={parent.id}
                              main={<button onClick={() => open(parent)}>{itemName(parent)}</button>}
                              side={
                                  <OpenThread
                                      item={parent}
                                      data={data}
                                      threadId={openQuestionThread(parent)?.id}
                                      label="Answer in T3"
                                  />
                              }
                          />,
                      ]
                    : []),
                ...ahead
                    .filter((p) => needsAnswer(p.item))
                    .map((p) => (
                        <Entry
                            key={p.item.id}
                            main={<PartLink part={p} />}
                            side={
                                <OpenThread
                                    item={p.item}
                                    data={data}
                                    threadId={openQuestionThread(p.item)?.id}
                                    label="Answer in T3"
                                />
                            }
                        />
                    )),
            ],
        },
        {
            key: 'verify',
            label: 'To verify or merge',
            tone: 'text-(--warning-foreground)',
            entries: ahead
                .filter(
                    (p) =>
                        (p.item.status === 'Verify' || p.item.status === 'Ready to merge') &&
                        !workingAgain(p.item, unavailable),
                )
                .map((p) => <Entry key={p.item.id} main={<PartLink part={p} />} side={p.item.status} />),
        },
        {
            key: 'decisions',
            label: 'Open decisions',
            tone: 'text-(--primary)',
            entries: ahead
                .filter((p) => DECISION_KINDS.includes(p.kind))
                .map((p) => (
                    <Entry
                        key={p.item.id}
                        main={<PartLink part={p} />}
                        side={`${partLabel(p.kind)} · ${shownStatus(p.item, unavailable).word}`}
                    />
                )),
        },
        {
            key: 'blocked',
            label: 'Blocked slices',
            tone: 'text-(--st-review)',
            entries: blocked.map(({ part, slice }, i) => (
                <Entry
                    key={i}
                    main={
                        <span className="flex min-w-0 items-start gap-1.5 text-[13px]">
                            <Ban className="mt-0.5 size-3.5 shrink-0 text-(--st-review)" />
                            <span className="line-clamp-2">
                                {slice.number > 0 && (
                                    <>
                                        <span className="text-(--muted-foreground) tabular-nums">
                                            #{slice.number}
                                        </span>{' '}
                                    </>
                                )}
                                {slice.title}
                            </span>
                        </span>
                    }
                    side={
                        <>
                            slice of{' '}
                            <button
                                type="button"
                                onClick={() => open(part.item)}
                                title={part.item.title}
                                className="rounded px-0.5 font-medium text-(--primary) tabular-nums hover:bg-(--accent)"
                            >
                                {ref(part.item)}
                            </button>{' '}
                            · waits on a re-slice
                        </>
                    }
                />
            )),
        },
        {
            key: 'waiting',
            label: 'Waiting',
            tone: 'text-(--muted-foreground)',
            entries: ahead
                .filter((p) => openWaits(p).length && !needsAnswer(p.item))
                .map((p) => <Entry key={p.item.id} main={<PartLink part={p} />} side={waitsOn(p)} />),
        },
        {
            key: 'ready',
            label: 'Ready to start',
            tone: 'text-(--st-now)',
            entries: ahead
                .filter(startable)
                .map((p) => (
                    <Entry
                        key={p.item.id}
                        main={<PartLink part={p} />}
                        side={<PartStart part={p} data={data} label="Start" />}
                    />
                )),
        },
        {
            key: 'dependencies',
            label: 'Dependencies',
            tone: 'text-(--st-review)',
            entries: [
                ...holds.map(({ part, hold }) => (
                    <Entry
                        key={`${part.item.id} ${hold.dependencyId}`}
                        main={
                            <span
                                className="flex items-start gap-1.5 text-[13px]"
                                data-dependency-state={hold.met ? 'met' : 'unmet'}
                            >
                                {hold.met ? (
                                    <Check className="mt-0.5 size-3.5 shrink-0 text-(--st-done)" />
                                ) : (
                                    <Ban className="mt-0.5 size-3.5 shrink-0 text-(--st-review)" />
                                )}
                                <span>
                                    {hold.owner}: {hold.need}
                                </span>
                            </span>
                        }
                        side={
                            <>
                                {hold.met ? 'met' : 'not met'} · holds{' '}
                                <button
                                    type="button"
                                    onClick={() => open(part.item)}
                                    title={part.item.title}
                                    className="rounded px-0.5 font-medium text-(--primary) tabular-nums hover:bg-(--accent)"
                                >
                                    {ref(part.item)}
                                </button>
                            </>
                        }
                    />
                )),
                ...written.map((d) => (
                    <Entry
                        key={d}
                        main={
                            <span className="flex items-start gap-1.5 text-[13px]">
                                <Ban className="mt-0.5 size-3.5 shrink-0 text-(--st-review)" />
                                <span>
                                    <Refs text={d} find={find} />
                                </span>
                            </span>
                        }
                    />
                )),
            ],
        },
        {
            key: 'fog',
            label: 'Fog',
            tone: 'text-(--st-amber)',
            entries: (parent.map?.fog ?? []).map((q) => (
                <Entry
                    key={q}
                    main={
                        <span className="flex items-start gap-1.5 text-[13px]">
                            <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-(--st-amber)" />
                            <span>
                                <Refs text={q} find={find} />
                            </span>
                        </span>
                    }
                />
            )),
        },
    ].filter((r) => r.entries.length && (!only || only.includes(r.key)));

    return rows;
}
