import type { BoardData, Item, ModelChoice } from '@lar-factory/shared';
import { highlightedChoice, repositoryT3Default } from '@lar-factory/shared';

import { ModelEntries } from './ModelEntries';
import { useStartStore } from './StartStore';

/** "Project default in T3", then each provider instance's models, with the remembered choice checked. Sample mode shows them but starts nothing. */
export function StartEntries({
    item,
    data,
    onPick,
    requireModel = false,
}: {
    item: Item;
    data: BoardData;
    requireModel?: boolean;
    onPick: (choice: ModelChoice | undefined) => void;
}) {
    const lastChoice = useStartStore((state) => state.lastChoice);

    return (
        <ModelEntries
            groups={data.modelChoices}
            t3Default={repositoryT3Default(data, item.repo)}
            selected={highlightedChoice(data.modelChoices, lastChoice)}
            heading="Start with"
            held={data.capture?.enabled === false ? 'Disabled in sample mode' : undefined}
            defaultHeld={requireModel ? 'Choose a model to continue in the existing worktree.' : undefined}
            itemId={item.id}
            onPick={onPick}
        />
    );
}
