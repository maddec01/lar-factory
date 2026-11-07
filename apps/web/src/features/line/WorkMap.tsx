// A dossier's map, its current work first: a Decisions lane, a Builds lane for the dossier's own repository and a lane
// for each other repository, named by its project icon and name, parts placed left to right by what they wait on, arrows between them, ending in the end-to-end check when one is written. Finished history folds into
// one group below, which every arrow to or from a finished part starts or ends on, labelled with how many parts it stands for and naming them on hover and focus.

import { ref } from '@lar-factory/shared';
import type { BoardData, EndToEndCheck } from '@lar-factory/shared';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@lar-works/design-system';
import { ChevronDown, ChevronRight, Hammer, Lightbulb } from '@lar-works/design-system/icons';
import { useId, useState } from 'react';

import { isDone, isHistory, upstreamOf } from './DossierParts';
import type { Part } from './DossierParts';
import { useWidth } from './useWidth';
import { DECISIONS, GROUP_H, HISTORY, LABEL_W, edgeLine, historyText, keyOf, layout } from './WorkMapLayout';
import { CheckNode, HistoryRow, PartNode, RepoIdentity } from './WorkMapParts';
import { StatusGlyph } from '@/features/items';

/** The map of `parts`, current work first and finished history folded below, ending in `check` when one is written. `home` is the dossier's own repository, which needs no naming. */
export function WorkMap({
    parts,
    check,
    data,
    home,
}: {
    parts: Part[];
    check: EndToEndCheck | undefined;
    data: BoardData;
    home: string;
}) {
    const { ref: box, width } = useWidth();
    const [hover, setHover] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const marker = useId().replace(/[^a-zA-Z0-9]/g, '');

    if (!parts.length && !check) return null;

    const m = layout(parts, data, width, Boolean(check));
    const at = new Map(m.placed.map((p) => [p.key, p]));
    const near = (key: string) =>
        !hover ||
        key === hover ||
        m.edges.some((e) => (e.from === hover && e.to === key) || (e.to === hover && e.from === key));
    const builds = parts
        .filter((p) => p.kind === 'build' && !isHistory(p))
        .map((p) => ref(p.item))
        .join(', ')
        .replace(/, ([^,]*)$/, ' and $1');
    const history = parts.filter(isHistory);
    const ups = upstreamOf(parts);

    return (
        <div ref={box} className="overflow-x-auto rounded-lg border border-(--border) bg-(--background)" data-work-map>
            <div className="relative" style={{ width: m.width, height: m.height }} data-map-canvas>
                {m.bands.map((b, n) => (
                    <div
                        key={b.lane}
                        className={`absolute left-0 ${n ? 'border-t border-(--border)' : ''} ${n % 2 ? 'bg-[color-mix(in_srgb,var(--muted)_50%,transparent)]' : ''}`}
                        style={{ top: b.top, height: b.height, width: m.width }}
                    >
                        <div
                            className="sticky left-0 flex h-full flex-col justify-center gap-0.5 bg-[color-mix(in_srgb,var(--background)_85%,transparent)] px-3"
                            style={{ width: LABEL_W }}
                        >
                            <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
                                {b.lane === DECISIONS ? (
                                    <>
                                        <Lightbulb className="size-3.5 text-(--muted-foreground)" />
                                        {DECISIONS}
                                    </>
                                ) : b.lane === home ? (
                                    <>
                                        <Hammer className="size-3.5 text-(--muted-foreground)" />
                                        Builds
                                    </>
                                ) : (
                                    <RepoIdentity repo={b.lane} data={data} />
                                )}
                            </span>
                        </div>
                    </div>
                ))}
                <svg
                    className="pointer-events-none absolute inset-0"
                    width={m.width}
                    height={m.height}
                    aria-hidden="true"
                >
                    <defs>
                        {['done', 'open'].map((k) => (
                            <marker
                                key={k}
                                id={`${marker}-${k}`}
                                viewBox="0 0 8 8"
                                refX="7"
                                refY="4"
                                markerWidth="7"
                                markerHeight="7"
                                orient="auto"
                            >
                                <path
                                    d="M0 0 8 4 0 8z"
                                    fill={k === 'done' ? 'var(--st-done)' : 'var(--muted-foreground)'}
                                />
                            </marker>
                        ))}
                    </defs>
                    {m.edges.map((e) => {
                        const a = at.get(e.from),
                            b = at.get(e.to);
                        const d = edgeLine(m, a, b);

                        if (!d) return null;

                        const done = e.from === HISTORY || (!!a?.part && isDone(a.part.item));
                        const lit = !!hover && (e.from === hover || e.to === hover);

                        return (
                            <path
                                key={`${e.from}-${e.to}`}
                                d={d}
                                fill="none"
                                data-edge={`${e.from} ${e.to}`}
                                stroke={done ? 'var(--st-done)' : 'var(--muted-foreground)'}
                                strokeWidth={lit ? 2.5 : 1.5}
                                strokeDasharray={done ? undefined : '5 4'}
                                opacity={hover && !lit ? 0.2 : done ? 0.7 : 0.9}
                                markerEnd={`url(#${marker}-${done ? 'done' : 'open'})`}
                            />
                        );
                    })}
                </svg>
                {m.edges.map((e) => {
                    if (!e.label) return null;

                    const to = at.get(e.to),
                        from = at.get(e.from);
                    const place = to
                        ? { left: to.x, top: to.y - 15, width: m.nodeW }
                        : from
                          ? { left: from.x + m.nodeW + 14, top: m.groupY - 15, width: m.colW - 20 }
                          : null;

                    return (
                        place && (
                            <Tooltip key={`${e.from}-${e.to}`}>
                                <TooltipTrigger asChild>
                                    <button
                                        type="button"
                                        aria-label={`${e.label}: ${e.names}`}
                                        onClick={() => setShowHistory(true)}
                                        data-edge-label={`${e.from} ${e.to}`}
                                        className="absolute truncate rounded text-left text-[11px] leading-3.5 text-(--muted-foreground) hover:text-(--foreground) hover:underline focus-visible:outline-2 focus-visible:outline-(--primary)"
                                        style={{ left: place.left, top: place.top, maxWidth: place.width }}
                                    >
                                        {e.label}
                                    </button>
                                </TooltipTrigger>
                                <TooltipPopup side="top">{e.names}</TooltipPopup>
                            </Tooltip>
                        )
                    );
                })}
                {m.placed.map((p) => (
                    <div
                        key={p.key}
                        className={`absolute transition-opacity ${near(p.key) ? '' : 'opacity-40'}`}
                        style={{ left: p.x, top: p.y }}
                        onMouseEnter={() => setHover(p.key)}
                        onMouseLeave={() => setHover(null)}
                    >
                        {p.part ? (
                            <PartNode part={p.part} data={data} width={m.nodeW} home={home} />
                        ) : (
                            check && <CheckNode check={check} width={m.nodeW} after={builds} />
                        )}
                    </div>
                ))}
                {history.length > 0 && (
                    <button
                        type="button"
                        aria-expanded={showHistory}
                        onClick={() => setShowHistory(!showHistory)}
                        data-map-history
                        onMouseEnter={() => setHover(HISTORY)}
                        onMouseLeave={() => setHover(null)}
                        className={`absolute flex items-center gap-2 rounded-lg border border-(--border) bg-(--card) px-2.5 text-left text-xs shadow-xs transition-opacity hover:bg-(--accent) focus-visible:outline-2 focus-visible:outline-(--primary) ${near(HISTORY) ? '' : 'opacity-40'}`}
                        style={{ left: 12, right: 12, top: m.groupY, height: GROUP_H }}
                    >
                        <StatusGlyph status="Done" className="size-3.5 shrink-0" />
                        <span className="min-w-0 truncate font-medium">{historyText(history)}</span>
                        <span className="inline-flex shrink-0 items-center gap-1 text-(--muted-foreground)">
                            {showHistory ? (
                                <>
                                    Hide
                                    <ChevronDown className="size-3.5" />
                                </>
                            ) : (
                                <>
                                    Show
                                    <ChevronRight className="size-3.5" />
                                </>
                            )}
                        </span>
                    </button>
                )}
            </div>
            {showHistory && (
                <ol
                    className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,28rem),1fr))] gap-x-4 gap-y-1 px-3 pb-3"
                    style={{ width: m.width }}
                    data-map-history-parts
                >
                    {history.map((p) => (
                        <HistoryRow key={keyOf(p)} part={p} after={ups(p).filter(isHistory)} data={data} home={home} />
                    ))}
                </ol>
            )}
        </div>
    );
}
