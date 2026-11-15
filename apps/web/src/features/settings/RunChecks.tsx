import { Alert, Button } from '@lar-works/design-system';
import { BanIcon } from '@lar-works/design-system/icons';

import { useRecheckStore } from '@/features/notices';
import { useBoardStore } from '@/services/board/board.hooks';
import { sampleCapability } from '@/shared/capabilities/sampleCapability';
import { buttonKind } from '@/ui/board';

/** Diagnostics can run checks without needing an existing failure notice. */
export function RunChecks() {
    const { checking, answer, recheck } = useRecheckStore();
    const reason = useBoardStore((state) => sampleCapability(state.data, 'tools'));

    return (
        <>
            <Button
                {...buttonKind('other')}
                busy={checking}
                disabled={!!reason}
                leftIcon={reason ? <BanIcon /> : undefined}
                title={reason ?? undefined}
                aria-description={reason ?? undefined}
                data-recheck
                onClick={() => void recheck()}
            >
                Run checks
            </Button>
            {answer?.error && (
                <Alert size="sm" tone="danger">
                    {answer.error}
                </Alert>
            )}
        </>
    );
}
