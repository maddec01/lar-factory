// A dossier's reading for its line: its parts done and counted, its chips, what's next and its threads.

import { needsAnswer, plural, itemName, repoKey, repoName, workingAgain } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Ban, CircleHelp, MessagesSquare } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { DECISION_KINDS, isDone, threadAtWork, threadsOf } from './DossierParts';
import type { Part } from './DossierParts';
import { startable } from './PartStart';
import { YOURS } from './StageTrack';
import { StatusGlyph } from '@/features/items';

type Slice = Item['slices'][number];

/** A dossier's reading for its header: parts done and counted, and the parts each chip and "what's next" name.
 *  `needsYou` holds the parts in Needs you; `yours` adds those in Verify or Ready to merge. */
export interface Moving {
    parts: Part[];
    done: number;
    count: number;
    needsYou: Part[];
    yours: Part[];
    decisions: Part[];
    blockedSlices: { part: Part; slice: Slice }[];
    ready: Part[];
    active: Part[];
    fog: string[];
}

export function moving(parent: Item, parts: Part[], unavailable: boolean): Moving {
    const ahead = parts.filter((p) => !isDone(p.item));

    return {
        parts,
        done: Math.max(parent.subIssues.completed, parts.length - ahead.length),
        count: Math.max(parent.subIssues.total, parts.length),
        needsYou: ahead.filter((p) => needsAnswer(p.item)),
        yours: ahead.filter((p) => YOURS.includes(p.item.status) && !workingAgain(p.item, unavailable)),
        decisions: ahead.filter((p) => DECISION_KINDS.includes(p.kind)),
        blockedSlices: ahead.flatMap((part) =>
            part.item.slices.filter((s) => s.progress === 'blocked').map((slice) => ({ part, slice })),
        ),
        ready: ahead.filter(startable),
        active: ahead.filter(
            (p) =>
                !needsAnswer(p.item) &&
                (['Shaping', 'In progress', 'Review'].includes(p.item.status) || workingAgain(p.item, unavailable)),
        ),
        fog: parent.map?.fog ?? [],
    };
}

/** The repositories the parts work in beyond the dossier's own, which its row already names. */
export const otherRepos = (parent: Item, m: Moving, data: BoardData) =>
    [
        ...new Set(
            m.parts
                .filter((p) => repoKey(p.item) !== repoKey(parent))
                .map((p) => repoName(repoKey(p.item), data.repos)),
        ),
    ]
        .map((name) => `+ ${name}`)
        .join(' ');

/** The one thing to say next: what waits on you (a part in Needs you first), else what can start, else what's moving. */
export function nextOf(
    m: Moving,
    parent: Item,
): { tone: 'you' | 'start' | 'moving' | 'none'; part?: Part; text: string } {
    if (needsAnswer(parent)) return { tone: 'you', text: itemName(parent) };

    const yours = m.needsYou[0] ?? m.yours[0];

    if (yours) return { tone: 'you', part: yours, text: `${itemName(yours.item)}` };

    if (m.ready[0]) return { tone: 'start', part: m.ready[0], text: `${itemName(m.ready[0].item)}` };

    if (m.active[0]) return { tone: 'moving', part: m.active[0], text: `${itemName(m.active[0].item)}` };

    if (m.count > m.parts.length) return { tone: 'none', text: 'Some parts are outside the board' };

    return { tone: 'none', text: noDelivery(parent) ? 'No delivery planned' : 'Nothing waits on you' };
}

/** The dossier's T3 threads, then how many run and how many wait for the user's reply, each left out at zero (with no
 *  threads, nothing), so the threads' wording never contradicts the "need you" chip, which counts parts. */
function threadCounts(threads: ReturnType<typeof threadsOf>): string {
    if (!threads.length) return '';

    const running = threads.filter(threadAtWork).length;
    const waiting = threads.filter((t) => t.state === 'needs you').length;

    return [
        plural(threads.length, 'T3 thread'),
        running && `${running} running`,
        waiting && `${waiting} awaiting your reply`,
    ]
        .filter(Boolean)
        .join(' · ');
}

/** The reason a concept's delivery record gives when no active build is left to deliver it. */
export const NO_DELIVERY = 'No delivery planned.';

export interface Chip {
    words: string;
    tone: 'warning' | 'danger' | 'neutral' | 'accent' | 'success';
    icon?: ReactNode;
    refined?: boolean;
}

export const noDelivery = (parent: Item) =>
    Boolean(parent.refinement?.complete && parent.completion?.reasons.includes(NO_DELIVERY));

/** The dossier's chips, most important first, each left out at zero: what asks the user to act (parts in Needs you, open
 *  decisions, blocked slices), then a complete Refinement, which says nothing of delivery unless none is planned, per
 *  ADR 0003, then the map's remaining fog. */
export function chipsOf(parent: Item, m: Moving): Chip[] {
    const count = (n: number, word: string, tone: Chip['tone'], icon: ReactNode): Chip[] =>
        n ? [{ words: `${n} ${word}`, tone, icon }] : [];

    return [
        ...count(m.needsYou.length, 'need you', 'warning', <StatusGlyph status="Needs you" className="size-3" />),
        ...count(m.decisions.length, m.decisions.length === 1 ? 'decision' : 'decisions', 'accent', <MessagesSquare />),
        ...count(m.blockedSlices.length, 'blocked', 'danger', <Ban />),
        ...(parent.refinement?.complete ? [{ words: 'Refined', tone: 'success' as const, refined: true }] : []),
        ...(noDelivery(parent) ? [{ words: 'no delivery planned', tone: 'neutral' as const }] : []),
        ...count(m.fog.length, 'fog', 'neutral', <CircleHelp />),
    ];
}

/** The row's tooltip: every chip's words, so one that doesn't show still reads, then the thread counts. */
export const rowTooltip = (chips: Chip[], threads: ReturnType<typeof threadsOf>) =>
    [...chips.map((c) => c.words), threadCounts(threads)].filter(Boolean).join(' · ') || undefined;
