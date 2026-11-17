// The work record's own text in the item dialog, ahead of any ticket's: a concept's map, a decision's text or any other
// record's brief, with its build phase, review rounds and the initial context it began with, folded. Export markdown
// writes it to Downloads as `lar-work export` does and names the files it wrote, or says why it couldn't. A record with no
// text yet is one quiet line; beside a Spec, the Spec's heading row carries Export and the record shows only what else it
// holds.
import {
    buildActivity,
    buildPhaseLabel,
    conceptMapProse,
    parseDecisionMethod,
    type Item,
    type RecordDetails,
} from '@lar-factory/shared';
import { Button, Disclosure, RichText, Text } from '@lar-works/design-system';
import { useState } from 'react';

import { ApproveBrief } from './ApproveBrief';
import { BriefChangeHistory } from './BriefChangeHistory';
import { DependencyStatus } from './DependencyStatus';
import { exportMarkdown } from './ExportRecord';
import { isGroupParent } from './group-parent';
import { SavedRunSettings } from './SavedRunSettings';
import { useBoardStore } from '@/services/board/board.hooks';
import { MarkdownDiagrams } from '@/shared/diagrams/MarkdownDiagrams';
import { ActionError, buttonKind, DetailFact, FactList, InlineList, MainSection, SectionHeader } from '@/ui/board';

const TITLE: Record<RecordDetails['bodyKind'], string> = { brief: 'Brief', map: 'Concept map', decision: 'Decision' };

export type Exported =
    | { state: 'idle' | 'exporting' }
    | { state: 'done'; paths: string[] }
    | { state: 'failed'; error: string };

export function ExportMarkdown({
    itemId,
    exported,
    setExported,
}: {
    itemId: string;
    exported: Exported;
    setExported: (e: Exported) => void;
}) {
    return (
        <Button
            {...buttonKind('other')}
            loading={exported.state === 'exporting'}
            onClick={() => void exportMarkdown(itemId, setExported)}
        >
            Export markdown
        </Button>
    );
}

/** The files an export wrote, or why it couldn't; nothing before one runs. */
export function ExportedLine({ exported }: { exported: Exported }) {
    if (exported.state === 'done')
        return (
            <Text variant="caption" tone="muted" role="status" breaks>
                Exported to {exported.paths.join(', ')}
            </Text>
        );

    if (exported.state === 'failed') return <ActionError>{exported.error}</ActionError>;

    return null;
}

export function RecordText({
    item,
    record,
    spec = false,
    refresh,
}: {
    spec?: boolean;
    item: Item;
    record: RecordDetails;
    refresh?: () => Promise<boolean>;
}) {
    const [exported, setExported] = useState<Exported>({ state: 'idle' });
    const items = useBoardStore((state) => state.data.items);
    const group = isGroupParent(item, items);
    const pendingBriefs = group
        ? items
              .filter(
                  (part) =>
                      part.parentId === item.id &&
                      part.passingBrief === false &&
                      !part.briefChangesRequested &&
                      !['concept', 'decision', 'slice'].includes(part.kind) &&
                      part.status !== 'Done',
              )
              .map((part) => part.id)
        : [];
    const reviewing = item.briefReviewing
        ? item
        : items.find((part) => pendingBriefs.includes(part.id) && part.briefReviewing);
    const answer = record.bodyKind === 'decision' ? record.answer?.trim() : undefined;
    const body =
        record.bodyKind === 'map'
            ? conceptMapProse(record.body ?? '')
            : record.bodyKind === 'decision' && record.body && parseDecisionMethod(record.body)
              ? record.body.split('\n').slice(1).join('\n').trimStart()
              : record.body;
    const buildPhase = item.buildPhase === undefined ? record.buildPhase : item.buildPhase;
    const title = spec ? 'Work record' : answer ? 'Outcome' : TITLE[record.bodyKind];
    // A single item's own brief waiting for approval.
    const approvable =
        !group &&
        !item.setAside &&
        record.bodyKind === 'brief' &&
        Boolean(record.body) &&
        !item.briefChangesRequested &&
        !item.briefReviewing &&
        item.passingBrief === false &&
        item.status !== 'Done';
    // What the record holds besides its text: a Spec's record shows only these, under the Spec's own heading row.
    const extras =
        Boolean(record.briefChangeRequests) ||
        Boolean(reviewing) ||
        (!item.setAside && pendingBriefs.length > 0) ||
        approvable ||
        Boolean(record.reviewers) ||
        Boolean(record.runSettings) ||
        Boolean(buildPhase) ||
        record.reviewRounds.length > 0;
    // No text yet: one quiet line says who writes it, with no heading or Export over nothing.
    const unwritten = !spec && !answer && !body;
    // An approvable brief shows the text its approval request returned in place of this body.
    const recordBody = !spec && !unwritten && (
        <div data-record-body>
            <MarkdownDiagrams text={answer || body!} />
        </div>
    );

    // With a Spec, the Spec's heading row carries Export, so a record with nothing else to show adds nothing.
    if (spec && !extras && !(record.bodyKind === 'brief' && item.blockers.some((b) => b.dependency))) return null;

    return (
        <MainSection
            as="section"
            header={
                unwritten ? (
                    <SectionHeader
                        heading={title}
                        empty={
                            record.bodyKind === 'brief'
                                ? 'No brief yet. Shaping writes it.'
                                : `No ${title.toLowerCase()} yet.`
                        }
                        prose
                    />
                ) : (
                    <SectionHeader heading={title} prose>
                        {!spec && <ExportMarkdown itemId={item.id} exported={exported} setExported={setExported} />}
                    </SectionHeader>
                )
            }
            data-record
        >
            {record.briefChangeRequests && (
                <BriefChangeHistory itemId={item.id} requests={record.briefChangeRequests} refresh={refresh} />
            )}
            <ExportedLine exported={exported} />
            {record.bodyKind === 'brief' && <DependencyStatus item={item} />}
            {reviewing && <Text role="status">{buildActivity(reviewing).label}</Text>}
            {!item.setAside && !reviewing && pendingBriefs.length > 0 && (
                <ApproveBrief itemId={pendingBriefs[0]!} workIds={pendingBriefs} onApproved={refresh} />
            )}
            {approvable ? <ApproveBrief itemId={item.id} body={recordBody} onApproved={refresh} /> : recordBody}
            {!spec && answer && body && (
                <Disclosure label="Original question" presentation="section">
                    <MarkdownDiagrams text={body} />
                </Disclosure>
            )}
            {record.reviewers && (
                <FactList data-selected-reviewers>
                    {record.reviewers.map((reviewer) => (
                        <DetailFact
                            key={reviewer.id}
                            label={`${reviewer.name} · ${reviewer.status}`}
                            presentation="record"
                        >
                            <Text>{reviewer.reason}</Text>
                            {reviewer.result && <Text>{reviewer.result}</Text>}
                        </DetailFact>
                    ))}
                </FactList>
            )}
            {record.runSettings && <SavedRunSettings runs={record.runSettings} />}
            {buildPhase && (
                <DetailFact label="Build phase" presentation="record" data-build-phase>
                    {buildPhaseLabel(buildPhase)}
                </DetailFact>
            )}
            {record.reviewRounds.length > 0 && (
                <FactList data-review-rounds>
                    {record.reviewRounds.map((r) => (
                        <DetailFact key={r.round} label={`Review round ${r.round}`} presentation="record">
                            <InlineList
                                items={r.reviewers.map(
                                    (v) =>
                                        `${v.axis}: ${v.verdict}${v.open > 0 ? `, ${v.open} of ${v.findings} findings open` : ''}`,
                                )}
                            />
                        </DetailFact>
                    ))}
                </FactList>
            )}
            {!spec && record.context && (
                <Disclosure label="Initial context" presentation="section">
                    <RichText text={record.context} format="markdown" />
                </Disclosure>
            )}
        </MainSection>
    );
}
