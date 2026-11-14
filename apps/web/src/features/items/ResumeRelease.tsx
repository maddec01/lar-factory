import type { BoardData, Item } from '@lar-factory/shared';
import { Button } from '@lar-works/design-system';
import { useState } from 'react';

import { writeState } from './ActionAvailability';
import { notify } from '@/features/notices';
import { postAction, receive } from '@/services/board/board.service';
import { buttonKind } from '@/ui/board';

/** Resume the recorded release owner through its durable notification; no shaping launch. */
export function ResumeRelease({ item, data }: { item: Item; data: BoardData }) {
    const [pending, setPending] = useState(false);
    const resume = async () => {
        if (pending) return;

        setPending(true);

        const result = await postAction('/api/resume-release', { itemId: item.id, revision: item.revision });

        receive(result);

        if (result.error) notify({ verb: 'Failed', item, message: result.error });

        setPending(false);
    };

    return (
        <Button
            {...buttonKind('main')}
            {...writeState(data)}
            busy={pending}
            aria-disabled={pending || undefined}
            onClick={() => void resume()}
        >
            {pending ? 'Resuming…' : 'Resume release'}
        </Button>
    );
}
