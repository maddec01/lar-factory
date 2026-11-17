// A lane row's PR checks, where its slices would be: the checks as a bar and their count in a word, the same in a stage
// row and a concept's part row.

import type { Checks } from '@lar-factory/shared';

import { checksCount, checksWord } from '@/features/items';
import { ChecksBar, RowCount, RowProgress, StaleChecks } from '@/ui/board';

/** The checks' bar and count; checks the board can't vouch for (`stale`) keep their counts, dimmed and still. */
export function ChecksProgress({ checks, stale, still }: { checks: Checks; stale: boolean; still: boolean }) {
    return (
        <RowProgress
            bar={
                <StaleChecks stale={stale}>
                    <ChecksBar checks={checks} still={still || stale} />
                </StaleChecks>
            }
            count={
                <StaleChecks stale={stale} untitled>
                    <RowCount
                        pr
                        title={[checksCount(checks), stale && 'Stale check observation'].filter(Boolean).join(' · ')}
                    >
                        {checksWord(checks)}
                    </RowCount>
                </StaleChecks>
            }
        />
    );
}
