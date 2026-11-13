import type { Item } from '@lar-factory/shared';

import { useShownStatus } from '@/features/items';
import { GroupStatus } from '@/ui/board';

export function GroupDetails({ item }: { item: Item }) {
    const shown = useShownStatus(item);

    return <GroupStatus>{shown.word}</GroupStatus>;
}
