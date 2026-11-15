// What a concept's dialog shares with its row on the board: the parts bar beside its count, and the open questions and
// dependencies its expanded row lists under its parts.

import type { BoardData, Item } from '@lar-factory/shared';

import { Attention } from './Attention';
import type { FindRef } from './DossierHelpers';
import { PartsBar } from './DossierLine';
import type { Part } from './DossierParts';
import { moving } from './DossierSummary';
import { useActivityUnavailable } from '@/features/items';

/** The concept's parts as its row's segmented bar, or nothing before it has parts. */
export function ConceptPartsBar({ parent, parts }: { parent: Item; parts: Part[] }) {
    const m = moving(parent, parts, useActivityUnavailable());

    return m.count > 0 ? <PartsBar m={m} /> : null;
}

/** What the concept depends on and doesn't know yet, as its expanded row lists them under its parts. */
export function ConceptOpenQuestions({ parent, parts, data }: { parent: Item; parts: Part[]; data: BoardData }) {
    const find: FindRef = (repo = parent.repo ?? '', n) =>
        data.items.find((i) => i.number === n && i.repo?.toLowerCase() === repo.toLowerCase());

    return <Attention parent={parent} parts={parts} data={data} find={find} only={['dependencies', 'fog']} />;
}
