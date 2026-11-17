import type { RecordDetails } from '@lar-factory/shared';
import { Disclosure, Text } from '@lar-works/design-system';

import { DetailFact, FactList } from '@/ui/board';

const SUMMARY: Record<string, string> = {
    Approved: 'No changes requested.',
    'Changes requested': 'Review found changes to make.',
    Skipped: 'Not needed for this change.',
    Failed: 'Review could not finish.',
    Running: 'Reviewing this change.',
    Completed: 'Review finished; verdict not yet recorded.',
    Waiting: 'Waiting to review.',
};

/** Results in plain words; selection rules, raw role reports and revisions are available on demand. */
export function SelectedReviewers({ reviewers }: { reviewers: NonNullable<RecordDetails['reviewers']> }) {
    return (
        <FactList data-selected-reviewers>
            {reviewers.map((reviewer) => (
                <DetailFact key={reviewer.id} label={`${reviewer.name} · ${reviewer.status}`} presentation="record">
                    <Text>{SUMMARY[reviewer.status] ?? 'Review status unavailable.'}</Text>
                    <Disclosure label="Reviewer details" presentation="section">
                        <Text breaks>{reviewer.reason}</Text>
                        {reviewer.result && <Text breaks>{reviewer.result}</Text>}
                    </Disclosure>
                </DetailFact>
            ))}
        </FactList>
    );
}
