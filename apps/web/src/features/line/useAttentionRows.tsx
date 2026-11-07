// What keeps a dossier's work moving, as the labelled rows its Attention lists.

import { needsAnswer, openQuestionThread, itemName, ref, workingAgain } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { AttentionEntry as Entry, AttentionMark, EntryButton, ItemTitle, RefButton } from '@lar-works/design-system';

import { Refs, PartLink } from './DossierEntries';
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
            tone: 'yours' as const,
            entries: [
                ...(needsAnswer(parent)
                    ? [
                          <Entry
                              key={parent.id}
                              main={<EntryButton onOpen={() => open(parent)}>{itemName(parent)}</EntryButton>}
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
            tone: 'yours' as const,
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
            tone: 'decision' as const,
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
            tone: 'blocked' as const,
            entries: blocked.map(({ part, slice }, i) => (
                <Entry
                    key={i}
                    main={
                        <AttentionMark mark="blocked" clamp>
                            <ItemTitle
                                reference={slice.number > 0 ? `#${slice.number}` : undefined}
                                title={slice.title}
                            />
                        </AttentionMark>
                    }
                    side={
                        <>
                            slice of{' '}
                            <RefButton title={part.item.title} onOpen={() => open(part.item)}>
                                {ref(part.item)}
                            </RefButton>{' '}
                            · waits on a re-slice
                        </>
                    }
                />
            )),
        },
        {
            key: 'waiting',
            label: 'Waiting',
            tone: 'waiting' as const,
            entries: ahead
                .filter((p) => openWaits(p).length && !needsAnswer(p.item))
                .map((p) => <Entry key={p.item.id} main={<PartLink part={p} />} side={waitsOn(p)} />),
        },
        {
            key: 'ready',
            label: 'Ready to start',
            tone: 'ready' as const,
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
            tone: 'blocked' as const,
            entries: [
                ...holds.map(({ part, hold }) => (
                    <Entry
                        key={`${part.item.id} ${hold.dependencyId}`}
                        main={
                            <AttentionMark
                                mark={hold.met ? 'met' : 'blocked'}
                                data-dependency-state={hold.met ? 'met' : 'unmet'}
                            >
                                {hold.owner}: {hold.need}
                            </AttentionMark>
                        }
                        side={
                            <>
                                {hold.met ? 'met' : 'not met'} · holds{' '}
                                <RefButton title={part.item.title} onOpen={() => open(part.item)}>
                                    {ref(part.item)}
                                </RefButton>
                            </>
                        }
                    />
                )),
                ...written.map((d) => (
                    <Entry
                        key={d}
                        main={
                            <AttentionMark mark="blocked">
                                <Refs text={d} find={find} />
                            </AttentionMark>
                        }
                    />
                )),
            ],
        },
        {
            key: 'fog',
            label: 'Fog',
            tone: 'fog' as const,
            entries: (parent.map?.fog ?? []).map((q) => (
                <Entry
                    key={q}
                    main={
                        <AttentionMark mark="fog">
                            <Refs text={q} find={find} />
                        </AttentionMark>
                    }
                />
            )),
        },
    ].filter((r) => r.entries.length && (!only || only.includes(r.key)));

    return rows;
}
