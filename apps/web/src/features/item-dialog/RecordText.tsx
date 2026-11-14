// The work record's own text in the item dialog, ahead of any ticket's: a concept's map, a decision's text or any other
// record's brief, with its build phase, review rounds and the initial context it began with, folded. Export markdown
// writes it to Downloads as `lar-work export` does and names the files it wrote, or says why it couldn't.

import {
    buildPhaseLabel,
    conceptMapProse,
    parseDecisionMethod,
    type Item,
    type RecordDetails,
} from '@lar-factory/shared';
import { Alert, EmptyState, Button, Disclosure, RichText, Text } from '@lar-works/design-system';
import { useState } from 'react';

import { ApproveBrief } from './ApproveBrief';
import { BriefChangeHistory } from './BriefChangeHistory';
import { isGroupParent } from './group-parent';
import { SavedRunSettings } from './SavedRunSettings';
import { useBoardStore } from '@/services/board/board.hooks';
import { postAction } from '@/services/board/board.service';
import { MarkdownDiagrams } from '@/shared/diagrams/MarkdownDiagrams';
import { buttonKind, DetailFact, FactList, InlineList, MainSection, SectionHeader } from '@/ui/board';

const TITLE: Record<RecordDetails['bodyKind'], string> = { brief: 'Brief', map: 'Map', decision: 'Decision' };

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
    const run = async () => {
        setExported({ state: 'exporting' });

        const result = await postAction<{ paths: string[] }>('/api/item-export', { itemId });

        setExported(
            result.error || !result.paths
                ? { state: 'failed', error: result.error ?? 'The board didn’t say what it wrote.' }
                : { state: 'done', paths: result.paths },
        );
    };

    return (
        <Button {...buttonKind('other')} loading={exported.state === 'exporting'} onClick={() => void run()}>
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

    if (exported.state === 'failed')
        return (
            <Alert size="sm" tone="danger">
                {exported.error}
            </Alert>
        );

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
    const reviewing =
        item.briefReviewing || pendingBriefs.some((id) => items.find((part) => part.id === id)?.briefReviewing);
    const answer = record.bodyKind === 'decision' ? record.answer?.trim() : undefined;
    const body =
        record.bodyKind === 'map'
            ? conceptMapProse(record.body ?? '')
            : record.bodyKind === 'decision' && record.body && parseDecisionMethod(record.body)
              ? record.body.split('\n').slice(1).join('\n').trimStart()
              : record.body;
    const buildPhase = item.buildPhase === undefined ? record.buildPhase : item.buildPhase;
    const title = spec ? 'Work record' : answer ? 'Outcome' : TITLE[record.bodyKind];

    return (
        <MainSection
            as="section"
            header={
                <SectionHeader heading={title}>
                    <ExportMarkdown itemId={item.id} exported={exported} setExported={setExported} />
                </SectionHeader>
            }
            data-record
        >
            {record.briefChangeRequests && (
                <BriefChangeHistory itemId={item.id} requests={record.briefChangeRequests} refresh={refresh} />
            )}
            <ExportedLine exported={exported} />
            {reviewing && <Text role="status">Doubt reviewing</Text>}
            {!item.setAside && !reviewing && pendingBriefs.length > 0 && (
                <ApproveBrief itemId={pendingBriefs[0]!} workIds={pendingBriefs} onApproved={refresh} />
            )}
            {!group &&
                !item.setAside &&
                record.bodyKind === 'brief' &&
                record.body &&
                !item.briefChangesRequested &&
                !item.briefReviewing &&
                item.passingBrief === false &&
                item.status !== 'Done' && <ApproveBrief itemId={item.id} onApproved={refresh} />}
            {!spec && (
                <div data-record-body>
                    {answer ? (
                        <MarkdownDiagrams text={answer} />
                    ) : body ? (
                        <MarkdownDiagrams text={body} />
                    ) : (
                        <EmptyState size="inline" title={`No ${title.toLowerCase()} written yet.`} />
                    )}
                </div>
            )}
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
